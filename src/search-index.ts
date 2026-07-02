import MiniSearch from 'minisearch';
import type { SearchOptions } from 'minisearch';
import { getFieldsByPattern, isDataField, subjects, title, author } from 'marc-ts';
import type { MarcRecord } from 'marc-ts';
import type { ReadableStore } from './types.js';

/**
 * Extracts zero or more searchable text values for one named field from a
 * MarcRecord. Kept independent per field so callers can add/remove/replace
 * fields without touching the rest of the configuration — MARC field usage
 * varies by cataloging practice, so nothing here is a fixed schema.
 */
export interface SearchFieldExtractor {
  name: string;
  extract(record: MarcRecord): string[];
}

export interface SearchIndexOptions {
  /** Field extractors to run over every record. Defaults to DEFAULT_SEARCH_FIELDS. */
  fields?: SearchFieldExtractor[];
  /** Per-field relevance boosts (default: title 2, author 1.5, subjects 1.5, contents 1). */
  boost?: Record<string, number>;
  /** MiniSearch fuzzy-match option (0/false disables fuzzy matching). Default 0.2. */
  fuzzy?: number | boolean;
  /** MiniSearch prefix-match option. Default true. */
  prefix?: boolean;
  /** Passthrough to MiniSearch's tokenizer, for catalogs with non-default punctuation/language needs. */
  tokenize?: (text: string, fieldName?: string) => string[];
  /** Passthrough to MiniSearch's term processor/normalizer. */
  processTerm?: (term: string, fieldName?: string) => string | string[] | null | undefined | false;
}

export interface SearchResultItem {
  position: number;
  score: number;
  match: Record<string, string[]>;
}

interface IndexedDocument {
  id: number;
  [fieldName: string]: unknown;
}

/**
 * Default field extractors: title (245), author (1xx main entry + 7xx added
 * entries), subjects (6xx), and a catch-all "contents" field over every data
 * field subfield for general recall.
 */
export const DEFAULT_SEARCH_FIELDS: SearchFieldExtractor[] = [
  {
    name: 'title',
    extract: (record) => {
      const t = title(record);
      return t ? [t] : [];
    },
  },
  {
    name: 'author',
    extract: (record) => {
      const values: string[] = [];
      const main = author(record);
      if (main) values.push(main);
      for (const field of getFieldsByPattern(record, '7XX')) {
        if (isDataField(field)) {
          for (const sub of field.subfields) {
            if (sub.code === 'a') values.push(sub.value);
          }
        }
      }
      return values;
    },
  },
  {
    name: 'subjects',
    extract: (record) => subjects(record),
  },
  {
    name: 'contents',
    extract: (record) =>
      record.fields.filter(isDataField).flatMap((field) => field.subfields.map((sub) => sub.value)),
  },
];

const DEFAULT_BOOST: Record<string, number> = { title: 2, author: 1.5, subjects: 1.5, contents: 1 };

/**
 * In-memory full-text search index over a ReadableStore's records, backed by
 * MiniSearch. Additive to the existing store architecture — build/rebuild
 * from a store snapshot via iterateRecords(); nothing here mutates the store.
 *
 * Indexes are keyed by `position` (the same number ReadableStore/EditableStore
 * use elsewhere), not by MARC control number (001), since 001 is a cataloging
 * convention rather than a guarantee (often missing/duplicated in real data).
 * Because the supported sync pattern is a full rebuild() after a batch of
 * edits, position values in the index are never stale relative to the store
 * they were built from — the index and the store's position numbering are
 * always regenerated together.
 *
 * Multiple independent SearchIndex instances can be built over the same
 * store, each scoped to different fields, to get separately queryable
 * indexes (e.g. a subjects-only index and a title/author-only index).
 */
export class SearchIndex {
  private readonly fields: SearchFieldExtractor[];
  private readonly searchOptions: SearchOptions;
  private readonly tokenize?: (text: string, fieldName?: string) => string[];
  private readonly processTerm?: (
    term: string,
    fieldName?: string
  ) => string | string[] | null | undefined | false;
  private mini: MiniSearch<IndexedDocument>;
  private _size = 0;

  constructor(options: SearchIndexOptions = {}) {
    this.fields = options.fields ?? DEFAULT_SEARCH_FIELDS;
    this.searchOptions = {
      boost: options.boost ?? DEFAULT_BOOST,
      fuzzy: options.fuzzy ?? 0.2,
      prefix: options.prefix ?? true,
    };
    this.tokenize = options.tokenize;
    this.processTerm = options.processTerm;
    this.mini = this.newMiniSearch();
  }

  private newMiniSearch(): MiniSearch<IndexedDocument> {
    return new MiniSearch<IndexedDocument>({
      idField: 'id',
      fields: this.fields.map((f) => f.name),
      searchOptions: this.searchOptions,
      ...(this.tokenize ? { tokenize: this.tokenize } : {}),
      ...(this.processTerm ? { processTerm: this.processTerm } : {}),
    });
  }

  /** Number of records currently indexed. */
  get size(): number {
    return this._size;
  }

  private toDocument(position: number, record: MarcRecord): IndexedDocument {
    const doc: IndexedDocument = { id: position };
    for (const field of this.fields) {
      doc[field.name] = field.extract(record).join(' ');
    }
    return doc;
  }

  /**
   * Builds the index from scratch over every record currently in `store`.
   * Discards any previously indexed documents. O(totalRecords), synchronous
   * and blocking — for very large stores this can take a visible amount of
   * time (no Worker-based indexing here).
   */
  build(store: ReadableStore): void {
    this.mini = this.newMiniSearch();
    const docs: IndexedDocument[] = [];
    for (const { index, record } of store.iterateRecords()) {
      docs.push(this.toDocument(index, record));
    }
    this.mini.addAll(docs);
    this._size = docs.length;
  }

  /**
   * Re-indexes fully from the current state of `store`. This is the
   * supported way to keep the index in sync after a batch of edits (e.g.
   * after applyToAll/applyToMatching/deleteMatching) — call rebuild(store)
   * once after the batch completes, rather than updating per-edit.
   */
  rebuild(store: ReadableStore): void {
    this.build(store);
  }

  /**
   * Adds or updates a single record's entry in the index without a full
   * rebuild. This is the seam a future live-sync decorator (wrapping
   * EditableStore to call add()/remove() around setRecord/insertRecord/
   * deleteRecord) would use; not called by build()/rebuild() themselves.
   * Caller is responsible for position stability across such calls.
   */
  add(position: number, record: MarcRecord): void {
    const doc = this.toDocument(position, record);
    if (this.mini.has(position)) {
      this.mini.replace(doc);
    } else {
      this.mini.add(doc);
      this._size++;
    }
  }

  /** Removes a single record's entry from the index. No-op if not present. */
  remove(position: number): void {
    if (this.mini.has(position)) {
      this.mini.discard(position);
      this._size--;
    }
  }

  /**
   * Runs a full-text query and returns matching positions ranked by
   * relevance. Feed `position` back into `store.getRecord(position)` to
   * retrieve the matching record.
   */
  search(query: string, limit?: number): SearchResultItem[] {
    const results = this.mini.search(query);
    const limited = limit !== undefined ? results.slice(0, limit) : results;
    return limited.map((r) => ({
      position: r.id as number,
      score: r.score,
      match: r.match,
    }));
  }
}
