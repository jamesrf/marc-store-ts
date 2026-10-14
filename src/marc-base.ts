import type { MarcRecord } from 'marc-ts';
import { parseMarcBinary } from 'marc-ts';
import type { RecordIndex } from './record-index.js';
import type { IndexIssue } from './record-index.js';
import { scanBuffer } from './record-index.js';
import { LRUCache } from './lru-cache.js';
import type { FromBufferOptions, RecordResult, ReadableStore, StoreOptions } from './types.js';
import { normalizeFromBufferOptions } from './types.js';

export function deepFreezeRecord(record: MarcRecord): MarcRecord {
  Object.freeze(record);
  Object.freeze(record.fields);
  for (const field of record.fields) {
    Object.freeze(field);
    if ('subfields' in field) {
      Object.freeze(field.subfields);
      for (const sub of field.subfields) {
        Object.freeze(sub);
      }
    }
  }
  return record;
}

type Field = MarcRecord['fields'][number];

function isFrozenField(field: Field): boolean {
  if (!Object.isFrozen(field)) return false;
  if (!('subfields' in field)) return true;
  return Object.isFrozen(field.subfields) && field.subfields.every((s) => Object.isFrozen(s));
}

function copyField(field: Field): Field {
  if (isFrozenField(field)) return field;
  return 'subfields' in field
    ? { ...field, subfields: field.subfields.map((s) => ({ ...s })) }
    : { ...field };
}

/**
 * Return a deep-frozen record equal to `record`, without freezing the
 * caller's objects. Parts that are already frozen (for example a record
 * read from the store, or fields that marc-ts helpers carried over from one)
 * are reused rather than copied.
 */
export function toFrozenRecord(record: MarcRecord): MarcRecord {
  if (
    Object.isFrozen(record) &&
    Object.isFrozen(record.fields) &&
    record.fields.every(isFrozenField)
  ) {
    return record;
  }
  return deepFreezeRecord({ ...record, fields: record.fields.map(copyField) });
}

export class MarcBase implements ReadableStore {
  private readonly rawBuffer: ArrayBuffer;
  private readonly rawBufferOffset: number;
  private readonly recordIndex: RecordIndex[];
  private readonly cache: LRUCache<number, MarcRecord>;
  /** Problems found while indexing the buffer (empty if none, or if the index was supplied). */
  readonly indexIssues: readonly IndexIssue[];

  constructor(
    rawBuffer: ArrayBuffer | Uint8Array,
    recordIndex: RecordIndex[],
    cacheCapacity = 200,
    options: StoreOptions = {}
  ) {
    if (rawBuffer instanceof Uint8Array) {
      this.rawBuffer = rawBuffer.buffer as ArrayBuffer;
      this.rawBufferOffset = rawBuffer.byteOffset;
    } else {
      this.rawBuffer = rawBuffer;
      this.rawBufferOffset = 0;
    }
    this.recordIndex = recordIndex;
    this.cache = new LRUCache(cacheCapacity);
    this.indexIssues = options.indexIssues ?? [];
  }

  /**
   * Index `buffer` with `scanBuffer` and construct a store over it. Issues
   * found while indexing are available as `indexIssues`, and are also logged
   * with `console.warn` unless an `onIssue` callback is supplied.
   *
   * @param options - Options object, or (legacy) the cache capacity
   */
  static fromBuffer(
    buffer: Uint8Array | ArrayBuffer,
    options?: number | FromBufferOptions
  ): MarcBase {
    const { cacheCapacity = 200, onIssue, ...scanOptions } = normalizeFromBufferOptions(options);
    const { index, issues } = scanBuffer(buffer, {
      ...scanOptions,
      onIssue: onIssue ?? ((issue) => console.warn(issue.message)),
    });
    return new MarcBase(buffer, index, cacheCapacity, { indexIssues: issues });
  }

  get totalRecords(): number {
    return this.recordIndex.length;
  }

  get indexCount(): number {
    return this.recordIndex.length;
  }

  getRecord(index: number): MarcRecord {
    if (index < 0 || index >= this.recordIndex.length) {
      throw new RangeError(`Record index ${index} out of range [0, ${this.recordIndex.length})`);
    }
    const cached = this.cache.get(index);
    if (cached !== undefined) return cached;

    const { offset, length } = this.recordIndex[index]!;
    if (length < 24) {
      throw new Error(`Record ${index} too short (${length} bytes, minimum 24)`);
    }
    let record: MarcRecord;
    try {
      const parsed = parseMarcBinary(
        new Uint8Array(this.rawBuffer, this.rawBufferOffset + offset, length),
        { strict: true }
      );
      if (parsed.length === 0) throw new Error('No record returned');
      record = deepFreezeRecord(parsed[0]!);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Parse failed at index ${index} (offset ${offset}): ${msg}`);
    }
    this.cache.set(index, record);
    return record;
  }

  tryGetRecord(index: number): RecordResult {
    try {
      return { ok: true, record: this.getRecord(index) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  *iterateRecords(): Generator<{ index: number; record: MarcRecord }> {
    for (let i = 0; i < this.recordIndex.length; i++) {
      yield { index: i, record: this.getRecord(i) };
    }
  }

  getSerializedRecord(index: number): Uint8Array {
    if (index < 0 || index >= this.recordIndex.length) {
      throw new RangeError(`Record index ${index} out of range [0, ${this.recordIndex.length})`);
    }
    const { offset, length } = this.recordIndex[index]!;
    return new Uint8Array(this.rawBuffer, this.rawBufferOffset + offset, length);
  }

  *iterateSerializedRecords(): Generator<Uint8Array> {
    for (let i = 0; i < this.recordIndex.length; i++) {
      const { offset, length } = this.recordIndex[i]!;
      yield new Uint8Array(this.rawBuffer, this.rawBufferOffset + offset, length);
    }
  }

  evictFromCache(index: number): void {
    this.cache.delete(index);
  }
}
