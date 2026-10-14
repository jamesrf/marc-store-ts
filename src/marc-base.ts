import type { MarcRecord } from 'marc-ts';
import { parseMarcBinary } from 'marc-ts';
import type { RecordIndex } from './record-index.js';
import type { IndexIssue } from './record-index.js';
import { scanBuffer } from './record-index.js';
import { LRUCache } from './lru-cache.js';
import type {
  FromBufferOptions,
  IdentifiedStore,
  RecordId,
  RecordResult,
  ReadableStore,
  StoreOptions,
} from './types.js';
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

const LEADER_ENCODER = new TextEncoder();

function leaderLengthMatches(bytes: Uint8Array, length: number): boolean {
  let n = 0;
  for (let i = 0; i < 5; i++) {
    const digit = bytes[i]! - 0x30;
    if (digit < 0 || digit > 9) return false;
    n = n * 10 + digit;
  }
  return n === length;
}

export class MarcBase implements ReadableStore, IdentifiedStore {
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
    if (options.copyBuffer) {
      const bytes = rawBuffer instanceof Uint8Array ? rawBuffer : new Uint8Array(rawBuffer);
      this.rawBuffer = bytes.slice().buffer;
      this.rawBufferOffset = 0;
    } else if (rawBuffer instanceof Uint8Array) {
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
   * found while indexing are available as `indexIssues` (and reported to
   * `onIssue` as they are found, if supplied).
   *
   * @param options - Options object, or (legacy) the cache capacity
   */
  static fromBuffer(
    buffer: Uint8Array | ArrayBuffer,
    options?: number | FromBufferOptions
  ): MarcBase {
    const { cacheCapacity = 200, copyBuffer, ...scanOptions } = normalizeFromBufferOptions(options);
    const { index, issues } = scanBuffer(buffer, scanOptions);
    return new MarcBase(buffer, index, cacheCapacity, { indexIssues: issues, copyBuffer });
  }

  get totalRecords(): number {
    return this.recordIndex.length;
  }

  getRecord(index: number): MarcRecord {
    if (index < 0 || index >= this.recordIndex.length) {
      throw new RangeError(`Record index ${index} out of range [0, ${this.recordIndex.length})`);
    }
    const cached = this.cache.get(index);
    if (cached !== undefined) return cached;

    const { offset } = this.recordIndex[index]!;
    let record: MarcRecord;
    try {
      const parsed = parseMarcBinary(this.recordBytes(index), { strict: true });
      if (parsed.length === 0) throw new Error('No record returned');
      record = deepFreezeRecord(parsed[0]!);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Parse failed at index ${index} (offset ${offset}): ${msg}`);
    }
    this.cache.set(index, record);
    return record;
  }

  /** Records in a MarcBase never move, so a record's ID is its index. */
  idAt(index: number): RecordId {
    if (!Number.isInteger(index) || index < 0 || index >= this.recordIndex.length) {
      throw new RangeError(`Record index ${index} out of range [0, ${this.recordIndex.length})`);
    }
    return index;
  }

  positionOf(id: RecordId): number | undefined {
    return Number.isInteger(id) && id >= 0 && id < this.recordIndex.length ? id : undefined;
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

  /**
   * The record's original bytes, as a copy the caller may modify freely.
   * If the leader length was wrong, it is corrected (see `scanBuffer`).
   * Use `iterateSerializedRecords()` for zero-copy access when writing out.
   */
  getSerializedRecord(index: number): Uint8Array {
    return this.getSerializedRecordView(index).slice();
  }

  /**
   * Zero-copy view of the record's original bytes. The view shares memory
   * with the store: writing to it corrupts the store, so treat it as read-only.
   * If the leader length was wrong, this is instead a copy with it corrected.
   */
  getSerializedRecordView(index: number): Uint8Array {
    if (index < 0 || index >= this.recordIndex.length) {
      throw new RangeError(`Record index ${index} out of range [0, ${this.recordIndex.length})`);
    }
    return this.recordBytes(index);
  }

  /**
   * Yields each record's bytes as a zero-copy view into the store's buffer.
   * Treat the views as read-only; writing to them corrupts the store.
   * Records whose leader length was wrong are yielded as corrected copies.
   */
  *iterateSerializedRecords(): Generator<Uint8Array> {
    for (let i = 0; i < this.recordIndex.length; i++) {
      yield this.recordBytes(i);
    }
  }

  /**
   * The record's bytes: a zero-copy view when the leader length matches the
   * indexed length, otherwise a copy with the leader length corrected (the
   * index, built from the record terminator, is the reliable boundary).
   */
  private recordBytes(index: number): Uint8Array {
    const { offset, length } = this.recordIndex[index]!;
    const bytes = new Uint8Array(this.rawBuffer, this.rawBufferOffset + offset, length);
    if (leaderLengthMatches(bytes, length) || length > 99999) return bytes;
    const repaired = bytes.slice();
    repaired.set(LEADER_ENCODER.encode(String(length).padStart(5, '0')), 0);
    return repaired;
  }

  evictFromCache(index: number): void {
    this.cache.delete(index);
  }
}
