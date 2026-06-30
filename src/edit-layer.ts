import type { MarcRecord } from 'marc-ts';
import { serializeMarcBinary } from 'marc-ts';
import type { MarcBase } from './marc-base.js';
import { deepFreezeRecord } from './marc-base.js';
import type { RecordResult, RecordSlot, EditableStore } from './types.js';

export class EditLayer implements EditableStore {
  private readonly base: MarcBase;
  private readonly _slots: RecordSlot[];

  constructor(base: MarcBase) {
    this.base = base;
    this._slots = Array.from({ length: base.indexCount }, (_, i): RecordSlot => ({ kind: 'original', index: i }));
  }

  get baseStore(): MarcBase {
    return this.base;
  }

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
    record = deepFreezeRecord(record);
    const slotIndex = this._slotIndexAt(position);
    if (slotIndex === -1) {
      throw new RangeError(`Record index ${position} out of range [0, ${this.totalRecords})`);
    }
    const current = this._slots[slotIndex];
    if (current.kind === 'inserted') {
      this._slots[slotIndex] = { kind: 'inserted', record };
    } else {
      const originalIndex = current.index;
      this._slots[slotIndex] = { kind: 'modified', index: originalIndex, record };
    }
  }

  deleteRecord(position: number): void {
    const slotIndex = this._slotIndexAt(position);
    if (slotIndex === -1) {
      throw new RangeError(`Record index ${position} out of range [0, ${this.totalRecords})`);
    }
    const current = this._slots[slotIndex];
    if (current.kind === 'inserted') {
      this._slots.splice(slotIndex, 1);
    } else {
      this._slots[slotIndex] = { kind: 'deleted', index: current.index };
      this.base.evictFromCache(current.index);
    }
  }

  insertRecord(record: MarcRecord, afterPosition?: number): void {
    record = deepFreezeRecord(record);
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
      this.base.evictFromCache(current.index);
      this._slots[slotIndex] = { kind: 'original', index: current.index };
    }
  }

  revertAll(): void {
    for (let i = this._slots.length - 1; i >= 0; i--) {
      const slot = this._slots[i];
      if (slot.kind === 'inserted') {
        this._slots.splice(i, 1);
      } else if (slot.kind === 'modified') {
        this.base.evictFromCache(slot.index);
        this._slots[i] = { kind: 'original', index: slot.index };
      } else if (slot.kind === 'deleted') {
        this._slots[i] = { kind: 'original', index: slot.index };
      }
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
      return this.base.getSerializedRecord(slot.index);
    }
    if (slot.kind === 'modified' || slot.kind === 'inserted') {
      return serializeMarcBinary([slot.record]);
    }
    throw new RangeError(`Record index ${position} is deleted`);
  }

  *iterateSerializedRecords(): Generator<Uint8Array> {
    for (const slot of this._slots) {
      if (slot.kind === 'deleted') continue;
      if (slot.kind === 'original') {
        yield this.base.getSerializedRecord(slot.index);
      } else {
        yield serializeMarcBinary([slot.record]);
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
    return this.base.getRecord(slot.index);
  }
}
