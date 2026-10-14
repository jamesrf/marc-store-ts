import type { MarcRecord } from 'marc-ts';
import type { IndexIssue, ScanOptions } from './record-index.js';

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
  /**
   * Delete several records at once. Positions refer to the store as it was
   * before the call; duplicates are ignored. Throws RangeError (deleting
   * nothing) if any position is out of range.
   */
  deleteRecords(positions: Iterable<number>): void;
  insertRecord(record: MarcRecord, afterPosition?: number): void;
  /** Insert several records, in order, after `afterPosition` (default: at the end). */
  insertRecords(records: Iterable<MarcRecord>, afterPosition?: number): void;
  revertRecord(position: number): void;
  revertAll(): void;
  isModified(position: number): boolean;
}

export interface StoreOptions {
  /** Issues found while indexing the buffer, exposed as `indexIssues`. */
  indexIssues?: readonly IndexIssue[];
  /**
   * Copy the buffer instead of keeping a reference to the caller's memory, so
   * later writes to that memory cannot change the store. Doubles peak memory
   * while loading. Default false.
   */
  copyBuffer?: boolean;
}

export interface FromBufferOptions extends ScanOptions {
  /** Maximum number of parsed records kept in the LRU cache. Default 200. */
  cacheCapacity?: number;
  /** See `StoreOptions.copyBuffer`. */
  copyBuffer?: boolean;
}

/** Accepts the legacy `cacheCapacity` number or an options object. */
export function normalizeFromBufferOptions(
  options: number | FromBufferOptions | undefined
): FromBufferOptions {
  return typeof options === 'number' ? { cacheCapacity: options } : (options ?? {});
}
