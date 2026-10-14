import MiniSearch from 'minisearch';
import type { SearchOptions } from 'minisearch';
import { getFieldsByPattern, isDataField, subjects, title, author } from 'marc-ts';
import type { MarcRecord } from 'marc-ts';
import type { IdentifiedStore, ReadableStore, RecordId } from './types.js';
import { iterateReadableRecords } from './iterate.js';
import type { RecordErrorOptions } from './iterate.js';

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
  /** The record's stable ID (see `RecordId`); equal to its position for stores without IDs. */
  id: RecordId;
  /** The record's position in the store now, for `store.getRecord(position)`. */
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

function hasIds(store: ReadableStore): store is ReadableStore & IdentifiedStore {
  const candidate = store as Partial<IdentifiedStore>;
  return typeof candidate.idAt === 'function' && typeof candidate.positionOf === 'function';
}

/**
 * In-memory full-text search index over a ReadableStore's records, backed by
 * MiniSearch. Built from a snapshot of the store via iterateRecords();
 * nothing here mutates the store.
 *
 * Documents are keyed by stable record ID (`RecordId`), not by position or by
 * MARC control number (001, often missing or duplicated in real data).
 * `search()` translates IDs to current positions using the store from the
 * last build(), so results stay correct when records are inserted or deleted
 * afterwards: deleted records drop out of the results, and positions reflect
 * the store's current numbering. Content changes (setRecord) are not picked
 * up until the record is re-added with add() or the index is rebuilt.
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
  private store: ReadableStore | null = null;

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

  private toDocument(id: RecordId, record: MarcRecord): IndexedDocument {
    const doc: IndexedDocument = { id };
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
   *
   * Records that cannot be parsed are handled per `options.onError`; skipped
   * records are not searchable.
   */
  build(store: ReadableStore, options: RecordErrorOptions = {}): void {
    this.mini = this.newMiniSearch();
    this.store = store;
    const idAt = hasIds(store) ? (position: number) => store.idAt(position) : (p: number) => p;
    const docs: IndexedDocument[] = [];
    for (const { index, record } of iterateReadableRecords(store, options.onError)) {
      docs.push(this.toDocument(idAt(index), record));
    }
    this.mini.addAll(docs);
    this._size = docs.length;
  }

  /**
   * Re-indexes fully from the current state of `store`. Use it after a batch
   * of content edits (e.g. applyToAll/applyToMatching) to make the new
   * content searchable. Inserts and deletes alone don't require it: search
   * results already follow the store's current positions.
   */
  rebuild(store: ReadableStore, options: RecordErrorOptions = {}): void {
    this.build(store, options);
  }

  /**
   * Adds or updates a single record's entry without a full rebuild, e.g.
   * after `setRecord` or `insertRecord`. `id` is the record's stable ID from
   * `store.idAt(position)` (for stores without IDs, its position).
   */
  add(id: RecordId, record: MarcRecord): void {
    const doc = this.toDocument(id, record);
    if (this.mini.has(id)) {
      this.mini.replace(doc);
    } else {
      this.mini.add(doc);
      this._size++;
    }
  }

  /**
   * Removes a single record's entry from the index by stable ID. No-op if not
   * present. Not needed after deleting a record from an ID-aware store, since
   * deleted records are already left out of search results.
   */
  remove(id: RecordId): void {
    if (this.mini.has(id)) {
      this.mini.discard(id);
      this._size--;
    }
  }

  /**
   * Runs a full-text query and returns matching records ranked by relevance.
   * Each result has the record's stable `id` and its current `position`
   * (feed it to `store.getRecord(position)`). Records deleted from the store
   * since the index was built are left out.
   */
  search(query: string, limit?: number): SearchResultItem[] {
    const store = this.store;
    const positionOf =
      store !== null && hasIds(store)
        ? (id: RecordId) => store.positionOf(id)
        : (id: RecordId) => id;
    const items: SearchResultItem[] = [];
    for (const r of this.mini.search(query)) {
      if (limit !== undefined && items.length >= limit) break;
      const id = r.id as RecordId;
      const position = positionOf(id);
      if (position === undefined) continue;
      items.push({ id, position, score: r.score, match: r.match });
    }
    return items;
  }
}
