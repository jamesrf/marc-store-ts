import type { MarcRecord } from 'marc-ts';
import type { IndexIssue, RecordIndex } from './record-index.js';
import { scanBuffer } from './record-index.js';
import { MarcBase } from './marc-base.js';
import { EditLayer } from './edit-layer.js';
import type { FromBufferOptions, RecordResult, RecordSlot, StoreOptions } from './types.js';
import { normalizeFromBufferOptions } from './types.js';

export type { RecordResult, RecordSlot };

export class MarcFile {
  private readonly _base: MarcBase;
  private readonly _edits: EditLayer;

  constructor(
    rawBuffer: ArrayBuffer | Uint8Array,
    recordIndex: RecordIndex[],
    cacheCapacity = 200,
    options: StoreOptions = {}
  ) {
    this._base = new MarcBase(rawBuffer, recordIndex, cacheCapacity, options);
    this._edits = new EditLayer(this._base);
  }

  /**
   * Index `buffer` with `scanBuffer` and construct a store over it.
   *
   * Indexing problems are available afterwards as `indexIssues`. If that is
   * non-empty the file may be only partially indexed, and exporting it would
   * drop the unindexed records. For backward compatibility, issues are also
   * logged with `console.warn` unless an `onIssue` callback is supplied.
   *
   * @param options - Options object, or (legacy) the cache capacity
   */
  static fromBuffer(
    buffer: Uint8Array | ArrayBuffer,
    options?: number | FromBufferOptions
  ): MarcFile {
    const { cacheCapacity = 200, onIssue, ...scanOptions } = normalizeFromBufferOptions(options);
    const { index, issues } = scanBuffer(buffer, {
      ...scanOptions,
      onIssue: onIssue ?? ((issue) => console.warn(issue.message)),
    });
    return new MarcFile(buffer, index, cacheCapacity, { indexIssues: issues });
  }

  /** Problems found while indexing the buffer; see `scanBuffer`. */
  get indexIssues(): readonly IndexIssue[] {
    return this._base.indexIssues;
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
  get slots(): readonly Readonly<RecordSlot>[] {
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
  revertAll(): void {
    this._edits.revertAll();
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
