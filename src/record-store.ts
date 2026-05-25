import type { MarcRecord } from 'marc-ts';
import { parseMarcRecordStrict, serializeMarcRecord } from 'marc-ts';
import type { RecordIndex } from './record-index.js';
import { indexBuffer } from './record-index.js';
import { LRUCache } from './lru-cache.js';

export type RecordResult =
  | { ok: true; record: MarcRecord }
  | { ok: false; error: string };

type OriginalSlot = { kind: 'original'; index: number };
type ModifiedSlot = { kind: 'modified'; index: number; record: MarcRecord };
type DeletedSlot  = { kind: 'deleted';  index: number };
type InsertedSlot = { kind: 'inserted'; record: MarcRecord };

export type RecordSlot = OriginalSlot | ModifiedSlot | DeletedSlot | InsertedSlot;

export class MarcFile {
  private readonly rawBuffer: ArrayBuffer;
  private readonly recordIndex: RecordIndex[];
  private readonly cache: LRUCache<number, MarcRecord>;
  private readonly _slots: RecordSlot[];

  constructor(
    rawBuffer: ArrayBuffer | Uint8Array,
    recordIndex: RecordIndex[],
    cacheCapacity = 200
  ) {
    this.rawBuffer = rawBuffer instanceof Uint8Array ? rawBuffer.buffer as ArrayBuffer : rawBuffer;
    this.recordIndex = recordIndex;
    this.cache = new LRUCache(cacheCapacity);
    this._slots = recordIndex.map((_, i): OriginalSlot => ({ kind: 'original', index: i }));
  }

  static fromBuffer(buffer: Uint8Array | ArrayBuffer, cacheCapacity = 200): MarcFile {
    return new MarcFile(buffer, indexBuffer(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)), cacheCapacity);
  }

  // ========== Getters ==========

  get totalRecords(): number {
    return this._slots.filter(s => s.kind !== 'deleted').length;
  }

  get modifiedCount(): number {
    return this._slots.filter(s => s.kind !== 'original').length;
  }

  get slots(): readonly RecordSlot[] {
    return this._slots;
  }

  // ========== Retrieval ==========

  getRecord(position: number): MarcRecord {
    const slot = this._slotAt(position);
    if (slot === undefined) {
      throw new RangeError(`Record index ${position} out of range [0, ${this.totalRecords})`);
    }
    return this._resolveSlot(slot, position);
  }

  tryGetRecord(position: number): RecordResult {
    try {
      return { ok: true, record: this.getRecord(position) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  *iterateRecords(): Generator<{ index: number; record: MarcRecord }> {
    let position = 0;
    for (const slot of this._slots) {
      if (slot.kind === 'deleted') continue;
      yield { index: position, record: this._resolveSlot(slot, position) };
      position++;
    }
  }

  // ========== Editing ==========

  setRecord(position: number, record: MarcRecord): void {
    const slotIndex = this._slotIndexAt(position);
    if (slotIndex === -1) {
      throw new RangeError(`Record index ${position} out of range [0, ${this.totalRecords})`);
    }
    const current = this._slots[slotIndex];
    const originalIndex = current.kind === 'inserted' ? -1 : current.index;
    if (current.kind === 'inserted') {
      this._slots[slotIndex] = { kind: 'inserted', record };
    } else {
      this._slots[slotIndex] = { kind: 'modified', index: originalIndex, record };
      this.cache.set(originalIndex, record);
    }
  }

  deleteRecord(position: number): void {
    const slotIndex = this._slotIndexAt(position);
    if (slotIndex === -1) {
      throw new RangeError(`Record index ${position} out of range [0, ${this.totalRecords})`);
    }
    const current = this._slots[slotIndex];
    if (current.kind === 'inserted') {
      // Inserted records can be fully removed from the slot array
      this._slots.splice(slotIndex, 1);
    } else {
      this._slots[slotIndex] = { kind: 'deleted', index: current.index };
      this.cache.delete(current.index);
    }
  }

  insertRecord(record: MarcRecord, afterPosition?: number): void {
    if (afterPosition === undefined) {
      this._slots.push({ kind: 'inserted', record });
      return;
    }
    const slotIndex = this._slotIndexAt(afterPosition);
    if (slotIndex === -1) {
      throw new RangeError(`Record index ${afterPosition} out of range [0, ${this.totalRecords})`);
    }
    this._slots.splice(slotIndex + 1, 0, { kind: 'inserted', record });
  }

  revertRecord(position: number): void {
    const slotIndex = this._slotIndexAt(position);
    if (slotIndex === -1) return;
    const current = this._slots[slotIndex];
    if (current.kind === 'modified') {
      this.cache.delete(current.index);
      this._slots[slotIndex] = { kind: 'original', index: current.index };
    }
  }

  isModified(position: number): boolean {
    const slot = this._slotAt(position);
    return slot !== undefined && slot.kind !== 'original';
  }

  // ========== Serialization ==========

  getSerializedRecord(position: number): Uint8Array {
    const slot = this._slotAt(position);
    if (slot === undefined) {
      throw new RangeError(`Record index ${position} out of range [0, ${this.totalRecords})`);
    }
    if (slot.kind === 'original') {
      const { offset, length } = this.recordIndex[slot.index];
      return new Uint8Array(this.rawBuffer, offset, length);
    }
    if (slot.kind === 'modified' || slot.kind === 'inserted') {
      return serializeMarcRecord(slot.record);
    }
    throw new RangeError(`Record index ${position} is deleted`);
  }

  *iterateSerializedRecords(): Generator<Uint8Array> {
    for (const slot of this._slots) {
      if (slot.kind === 'deleted') continue;
      if (slot.kind === 'original') {
        const { offset, length } = this.recordIndex[slot.index];
        yield new Uint8Array(this.rawBuffer, offset, length);
      } else {
        yield serializeMarcRecord(slot.record);
      }
    }
  }

  // ========== Private helpers ==========

  private _slotIndexAt(position: number): number {
    let current = 0;
    for (let i = 0; i < this._slots.length; i++) {
      if (this._slots[i].kind === 'deleted') continue;
      if (current === position) return i;
      current++;
    }
    return -1;
  }

  private _slotAt(position: number): RecordSlot | undefined {
    const i = this._slotIndexAt(position);
    return i === -1 ? undefined : this._slots[i];
  }

  private _resolveSlot(slot: RecordSlot, position: number): MarcRecord {
    if (slot.kind === 'modified' || slot.kind === 'inserted') {
      return slot.record;
    }
    if (slot.kind === 'deleted') {
      throw new RangeError(`Record index ${position} is deleted`);
    }
    // original — check cache then parse from buffer
    const cached = this.cache.get(slot.index);
    if (cached !== undefined) return cached;

    const { offset, length } = this.recordIndex[slot.index];
    if (length < 24) {
      throw new Error(`Record ${position} too short (${length} bytes, minimum 24)`);
    }
    let record: MarcRecord;
    try {
      record = parseMarcRecordStrict(new Uint8Array(this.rawBuffer, offset, length));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Parse failed at index ${position} (offset ${offset}): ${msg}`);
    }
    this.cache.set(slot.index, record);
    return record;
  }
}

// Backwards-compatible alias
export { MarcFile as RecordStore };
