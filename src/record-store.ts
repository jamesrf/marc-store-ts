import type { MarcRecord } from 'marc-ts';
import type { RecordIndex } from './record-index.js';
import { indexBuffer } from './record-index.js';
import { MarcBase } from './marc-base.js';
import { EditLayer } from './edit-layer.js';
import type { RecordResult, RecordSlot } from './types.js';

export type { RecordResult, RecordSlot };

export class MarcFile {
  private readonly _base: MarcBase;
  private readonly _edits: EditLayer;

  constructor(
    rawBuffer: ArrayBuffer | Uint8Array,
    recordIndex: RecordIndex[],
    cacheCapacity = 200
  ) {
    this._base = new MarcBase(rawBuffer, recordIndex, cacheCapacity);
    this._edits = new EditLayer(this._base);
  }

  static fromBuffer(buffer: Uint8Array | ArrayBuffer, cacheCapacity = 200): MarcFile {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return new MarcFile(buffer, indexBuffer(bytes), cacheCapacity);
  }

  get base(): MarcBase {
    return this._base;
  }
  get edits(): EditLayer {
    return this._edits;
  }

  get totalRecords(): number {
    return this._edits.totalRecords;
  }
  get modifiedCount(): number {
    return this._edits.modifiedCount;
  }
  get slots(): readonly RecordSlot[] {
    return this._edits.slots;
  }

  getRecord(position: number): MarcRecord {
    return this._edits.getRecord(position);
  }
  tryGetRecord(position: number): RecordResult {
    return this._edits.tryGetRecord(position);
  }

  *iterateRecords(): Generator<{ index: number; record: MarcRecord }> {
    yield* this._edits.iterateRecords();
  }

  setRecord(position: number, record: MarcRecord): void {
    this._edits.setRecord(position, record);
  }
  deleteRecord(position: number): void {
    this._edits.deleteRecord(position);
  }
  insertRecord(record: MarcRecord, afterPosition?: number): void {
    this._edits.insertRecord(record, afterPosition);
  }
  revertRecord(position: number): void {
    this._edits.revertRecord(position);
  }
  isModified(position: number): boolean {
    return this._edits.isModified(position);
  }

  getSerializedRecord(position: number): Uint8Array {
    return this._edits.getSerializedRecord(position);
  }

  *iterateSerializedRecords(): Generator<Uint8Array> {
    yield* this._edits.iterateSerializedRecords();
  }
}

export { MarcFile as RecordStore };
