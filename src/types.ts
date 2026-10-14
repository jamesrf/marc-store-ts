import type { MarcRecord } from 'marc-ts';
import type { IndexIssue, ScanOptions } from './record-index.js';

/**
 * The outcome of reading a record without throwing: the record, or the
 * error message explaining why it couldn't be read.
 */
export type RecordResult = { ok: true; record: MarcRecord } | { ok: false; error: string };

/**
 * A record's permanent identity in an editable store. Unlike a position, it
 * does not change when other records are inserted or deleted, and it is never
 * reused. Original records' IDs equal their index in the file; inserted
 * records get IDs counting up from the file's record count.
 */
export type RecordId = number;

/** An unmodified record, read from the original buffer. */
export type OriginalSlot = { kind: 'original'; id: RecordId; index: number };
/** An original record whose content was replaced. */
export type ModifiedSlot = { kind: 'modified'; id: RecordId; index: number; record: MarcRecord };
/** An original record that was deleted (it has no position). */
export type DeletedSlot = { kind: 'deleted'; id: RecordId; index: number };
/** A record added with `insertRecord`; it has no original counterpart. */
export type InsertedSlot = { kind: 'inserted'; id: RecordId; record: MarcRecord };

/**
 * The edit state of one record in an `EditLayer`. `index` is the record's
 * position in the original file; `record` holds the edited content.
 */
export type RecordSlot = OriginalSlot | ModifiedSlot | DeletedSlot | InsertedSlot;

/** A store you can read records from by position. */
export interface ReadableStore {
  /** Number of records. */
  readonly totalRecords: number;
  /** The record at `position`. Throws if out of range or unparseable. */
  getRecord(position: number): MarcRecord;
  /** Like `getRecord`, but returns a `RecordResult` instead of throwing. */
  tryGetRecord(position: number): RecordResult;
  /** Yields every record in position order. */
  iterateRecords(): Generator<{ index: number; record: MarcRecord }>;
  /**
   * Yields every record's MARC21 bytes in position order (original bytes
   * for unmodified records; treat them as read-only).
   */
  iterateSerializedRecords(): Generator<Uint8Array>;
  /** The MARC21 bytes of the record at `position`, as a copy. */
  getSerializedRecord(position: number): Uint8Array;
}

/** A store whose records have stable IDs (see `RecordId`). */
export interface IdentifiedStore {
  /** The ID of the record at `position`. Throws RangeError if out of range. */
  idAt(position: number): RecordId;
  /** The current position of the record with `id`, or undefined if it is deleted or unknown. */
  positionOf(id: RecordId): number | undefined;
}

/** A store that also supports copy-on-write edits by position. */
export interface EditableStore extends ReadableStore {
  /** Number of records that differ from the original. */
  readonly modifiedCount: number;
  /** Replace the record at `position`. */
  setRecord(position: number, record: MarcRecord): void;
  /** Delete the record at `position`; later records shift down. */
  deleteRecord(position: number): void;
  /**
   * Delete several records at once. Positions refer to the store as it was
   * before the call; duplicates are ignored. Throws RangeError (deleting
   * nothing) if any position is out of range.
   */
  deleteRecords(positions: Iterable<number>): void;
  /** Insert a record after `afterPosition` (default: at the end). */
  insertRecord(record: MarcRecord, afterPosition?: number): void;
  /** Insert several records, in order, after `afterPosition` (default: at the end). */
  insertRecords(records: Iterable<MarcRecord>, afterPosition?: number): void;
  /** Undo a modification of the record at `position`. */
  revertRecord(position: number): void;
  /** Discard every edit. */
  revertAll(): void;
  /** True if the record at `position` was modified or inserted. */
  isModified(position: number): boolean;
}

/** Options for constructing a `MarcBase` or `MarcFile` directly. */
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

/** Options for `MarcFile.fromBuffer` and `MarcBase.fromBuffer`. */
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
