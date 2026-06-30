import type { MarcRecord } from 'marc-ts';
import { parseMarcBinary } from 'marc-ts';
import type { RecordIndex } from './record-index.js';
import { indexBuffer } from './record-index.js';
import { LRUCache } from './lru-cache.js';
import type { RecordResult, ReadableStore } from './types.js';

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

export class MarcBase implements ReadableStore {
  private readonly rawBuffer: ArrayBuffer;
  private readonly rawBufferOffset: number;
  private readonly recordIndex: RecordIndex[];
  private readonly cache: LRUCache<number, MarcRecord>;

  constructor(
    rawBuffer: ArrayBuffer | Uint8Array,
    recordIndex: RecordIndex[],
    cacheCapacity = 200
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
  }

  static fromBuffer(buffer: Uint8Array | ArrayBuffer, cacheCapacity = 200): MarcBase {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return new MarcBase(buffer, indexBuffer(bytes), cacheCapacity);
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

    const { offset, length } = this.recordIndex[index];
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
      record = deepFreezeRecord(parsed[0]);
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
    const { offset, length } = this.recordIndex[index];
    return new Uint8Array(this.rawBuffer, this.rawBufferOffset + offset, length);
  }

  *iterateSerializedRecords(): Generator<Uint8Array> {
    for (let i = 0; i < this.recordIndex.length; i++) {
      const { offset, length } = this.recordIndex[i];
      yield new Uint8Array(this.rawBuffer, this.rawBufferOffset + offset, length);
    }
  }

  evictFromCache(index: number): void {
    this.cache.delete(index);
  }
}
