import type { MarcRecord } from 'marc-ts';

export type RecordResult = { ok: true; record: MarcRecord } | { ok: false; error: string };

type OriginalSlot = { kind: 'original'; index: number };
type ModifiedSlot = { kind: 'modified'; index: number; record: MarcRecord };
type DeletedSlot = { kind: 'deleted'; index: number };
type InsertedSlot = { kind: 'inserted'; record: MarcRecord };

export type RecordSlot = OriginalSlot | ModifiedSlot | DeletedSlot | InsertedSlot;

export interface ReadableStore {
  readonly totalRecords: number;
  getRecord(position: number): MarcRecord;
  tryGetRecord(position: number): RecordResult;
  iterateRecords(): Generator<{ index: number; record: MarcRecord }>;
  iterateSerializedRecords(): Generator<Uint8Array>;
  getSerializedRecord(position: number): Uint8Array;
}

export interface EditableStore extends ReadableStore {
  readonly modifiedCount: number;
  setRecord(position: number, record: MarcRecord): void;
  deleteRecord(position: number): void;
  insertRecord(record: MarcRecord, afterPosition?: number): void;
  revertRecord(position: number): void;
  isModified(position: number): boolean;
}
