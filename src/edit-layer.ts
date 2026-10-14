import type { MarcRecord } from 'marc-ts';
import { serializeMarcBinary } from 'marc-ts';
import type { MarcBase } from './marc-base.js';
import { toFrozenRecord } from './marc-base.js';
import type {
  RecordResult,
  RecordSlot,
  RecordId,
  EditableStore,
  IdentifiedStore,
} from './types.js';

export class EditLayer implements EditableStore, IdentifiedStore {
  private readonly _base: MarcBase;
  private _slots: RecordSlot[];
  private _totalRecords: number;
  private _modifiedCount: number;
  private _positionMap: number[] | null;
  private _positionMapDirty: boolean;
  private _nextId: RecordId;
  // Lazily built ID lookups, invalidated (with the position map) whenever slots move.
  private _slotOfId: Int32Array | null = null;
  private _positionOfSlot: Int32Array | null = null;

  constructor(base: MarcBase) {
    this._base = base;
    this._slots = Array.from({ length: base.totalRecords }, (_, i): RecordSlot => ({
      kind: 'original',
      id: i,
      index: i,
    }));
    this._nextId = base.totalRecords;
    this._totalRecords = base.totalRecords;
    this._modifiedCount = 0;
    this._positionMap = null;
    this._positionMapDirty = true;
  }

  get baseStore(): MarcBase {
    return this._base;
  }

  get totalRecords(): number {
    return this._totalRecords;
  }

  get modifiedCount(): number {
    return this._modifiedCount;
  }

  /** The slot (edit state) of the record at `position`, or undefined if out of range. */
  getSlot(position: number): Readonly<RecordSlot> | undefined {
    const slot = this._slotAt(position);
    return slot === undefined ? undefined : Object.freeze({ ...slot });
  }

  /** Yields every slot, including deleted ones, in file order. */
  *iterateSlots(): Generator<Readonly<RecordSlot>> {
    for (const slot of this._slots) yield Object.freeze({ ...slot });
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
    record = toFrozenRecord(record);
    const slotIndex = this._slotIndexAt(position);
    if (slotIndex === -1) {
      throw new RangeError(`Record index ${position} out of range [0, ${this.totalRecords})`);
    }
    const current = this._slots[slotIndex]!;
    if (current.kind === 'inserted') {
      this._slots[slotIndex] = { kind: 'inserted', id: current.id, record };
    } else {
      if (current.kind === 'original') this._modifiedCount++;
      const originalIndex = current.index;
      this._slots[slotIndex] = { kind: 'modified', id: current.id, index: originalIndex, record };
    }
  }

  deleteRecord(position: number): void {
    const slotIndex = this._slotIndexAt(position);
    if (slotIndex === -1) {
      throw new RangeError(`Record index ${position} out of range [0, ${this.totalRecords})`);
    }
    const current = this._slots[slotIndex]!;
    if (current.kind === 'inserted') {
      this._slots.splice(slotIndex, 1);
      this._totalRecords--;
      this._modifiedCount--;
    } else {
      if (current.kind === 'original') this._modifiedCount++;
      this._slots[slotIndex] = { kind: 'deleted', id: current.id, index: current.index };
      this._base.evictFromCache(current.index);
      this._totalRecords--;
    }
    this._invalidateMaps();
  }

  /**
   * Delete several records in one pass. Positions refer to the store as it
   * was before the call; duplicates are ignored. If any position is out of
   * range, throws RangeError and deletes nothing.
   */
  deleteRecords(positions: Iterable<number>): void {
    const map = this._ensurePositionMap();
    const marked = new Uint8Array(this._slots.length);
    let count = 0;
    for (const position of positions) {
      if (!Number.isInteger(position) || position < 0 || position >= map.length) {
        throw new RangeError(`Record index ${position} out of range [0, ${this.totalRecords})`);
      }
      const slotIndex = map[position]!;
      if (marked[slotIndex] === 0) {
        marked[slotIndex] = 1;
        count++;
      }
    }
    if (count === 0) return;

    // Compact in place: inserted slots are dropped, others become 'deleted'.
    let write = 0;
    for (let read = 0; read < this._slots.length; read++) {
      const slot = this._slots[read]!;
      if (marked[read] === 0) {
        this._slots[write++] = slot;
        continue;
      }
      this._totalRecords--;
      if (slot.kind === 'inserted') {
        this._modifiedCount--;
        continue;
      }
      if (slot.kind === 'original') this._modifiedCount++;
      this._base.evictFromCache(slot.index);
      this._slots[write++] = { kind: 'deleted', id: slot.id, index: slot.index };
    }
    this._slots.length = write;
    this._invalidateMaps();
  }

  insertRecord(record: MarcRecord, afterPosition?: number): void {
    record = toFrozenRecord(record);
    if (afterPosition === undefined) {
      this._slots.push({ kind: 'inserted', id: this._nextId++, record });
      this._totalRecords++;
      this._modifiedCount++;
      this._invalidateMaps();
      return;
    }
    const slotIndex = this._slotIndexAt(afterPosition);
    if (slotIndex === -1) {
      throw new RangeError(`Record index ${afterPosition} out of range [0, ${this.totalRecords})`);
    }
    this._slots.splice(slotIndex + 1, 0, { kind: 'inserted', id: this._nextId++, record });
    this._totalRecords++;
    this._modifiedCount++;
    this._invalidateMaps();
  }

  /**
   * Insert several records, in order, after `afterPosition` (default: at the
   * end), in a single splice.
   */
  insertRecords(records: Iterable<MarcRecord>, afterPosition?: number): void {
    let at = this._slots.length;
    if (afterPosition !== undefined) {
      const slotIndex = this._slotIndexAt(afterPosition);
      if (slotIndex === -1) {
        throw new RangeError(
          `Record index ${afterPosition} out of range [0, ${this.totalRecords})`
        );
      }
      at = slotIndex + 1;
    }
    const added: RecordSlot[] = [];
    for (const record of records) {
      added.push({ kind: 'inserted', id: this._nextId++, record: toFrozenRecord(record) });
    }
    if (added.length === 0) return;
    this._slots =
      at === this._slots.length
        ? this._slots.concat(added)
        : [...this._slots.slice(0, at), ...added, ...this._slots.slice(at)];
    this._totalRecords += added.length;
    this._modifiedCount += added.length;
    this._invalidateMaps();
  }

  /**
   * Restore the record at `position` to its original content if it was
   * modified. No-op for unmodified or inserted records. Deleted records have
   * no position and cannot be restored this way; use `revertAll()`.
   */
  revertRecord(position: number): void {
    const slotIndex = this._slotIndexAt(position);
    if (slotIndex === -1) return;
    const current = this._slots[slotIndex]!;
    if (current.kind === 'modified') {
      this._base.evictFromCache(current.index);
      this._slots[slotIndex] = { kind: 'original', id: current.id, index: current.index };
      this._modifiedCount--;
    }
  }

  revertAll(): void {
    for (let i = this._slots.length - 1; i >= 0; i--) {
      const slot = this._slots[i]!;
      if (slot.kind === 'inserted') {
        this._slots.splice(i, 1);
      } else if (slot.kind === 'modified') {
        this._base.evictFromCache(slot.index);
        this._slots[i] = { kind: 'original', id: slot.id, index: slot.index };
      } else if (slot.kind === 'deleted') {
        this._slots[i] = { kind: 'original', id: slot.id, index: slot.index };
      }
    }
    this._totalRecords = this._base.totalRecords;
    this._modifiedCount = 0;
    this._invalidateMaps();
  }

  // ========== Stable IDs ==========

  /** The stable ID of the record at `position`. Throws RangeError if out of range. */
  idAt(position: number): RecordId {
    const slot = this._slotAt(position);
    if (slot === undefined) {
      throw new RangeError(`Record index ${position} out of range [0, ${this.totalRecords})`);
    }
    return slot.id;
  }

  /** The current position of the record with `id`, or undefined if it is deleted or unknown. */
  positionOf(id: RecordId): number | undefined {
    const slotIndex = this._slotIndexOfId(id);
    if (slotIndex === -1) return undefined;
    const position = this._ensureIdMaps().positionOfSlot[slotIndex]!;
    return position === -1 ? undefined : position;
  }

  /** The record with `id`. Throws RangeError if it is deleted or unknown. */
  getRecordById(id: RecordId): MarcRecord {
    const position = this.positionOf(id);
    if (position === undefined) {
      throw new RangeError(`Record ID ${id} is deleted or does not exist`);
    }
    return this.getRecord(position);
  }

  /**
   * Restore the record with `id` to its original state: undoes a modification
   * or a deletion. Returns true if anything changed. Inserted records cannot
   * be reverted (delete them instead); unknown IDs are ignored.
   */
  revert(id: RecordId): boolean {
    const slotIndex = this._slotIndexOfId(id);
    if (slotIndex === -1) return false;
    const slot = this._slots[slotIndex]!;
    if (slot.kind === 'modified') {
      this._base.evictFromCache(slot.index);
      this._slots[slotIndex] = { kind: 'original', id: slot.id, index: slot.index };
      this._modifiedCount--;
      return true;
    }
    if (slot.kind === 'deleted') {
      this._slots[slotIndex] = { kind: 'original', id: slot.id, index: slot.index };
      this._modifiedCount--;
      this._totalRecords++;
      this._invalidateMaps();
      return true;
    }
    return false;
  }

  /** IDs of the original records that are currently deleted, in file order. */
  deletedIds(): RecordId[] {
    const ids: RecordId[] = [];
    for (const slot of this._slots) {
      if (slot.kind === 'deleted') ids.push(slot.id);
    }
    return ids;
  }

  isModified(position: number): boolean {
    const slot = this._slotAt(position);
    return slot !== undefined && slot.kind !== 'original';
  }

  // ========== Serialization ==========

  /**
   * The record's bytes as a new array the caller may modify freely: a copy of
   * the original bytes for an unmodified record, or a fresh serialization for
   * an edited/inserted one.
   */
  getSerializedRecord(position: number): Uint8Array {
    const slot = this._slotAt(position);
    if (slot === undefined) {
      throw new RangeError(`Record index ${position} out of range [0, ${this.totalRecords})`);
    }
    if (slot.kind === 'original') {
      return this._base.getSerializedRecord(slot.index);
    }
    if (slot.kind === 'modified' || slot.kind === 'inserted') {
      return serializeMarcBinary([slot.record]);
    }
    throw new RangeError(`Record index ${position} is deleted`);
  }

  /**
   * Yields every active record's bytes. Unmodified records are zero-copy
   * views into the store's buffer: treat them as read-only.
   */
  *iterateSerializedRecords(): Generator<Uint8Array> {
    for (const slot of this._slots) {
      if (slot.kind === 'deleted') continue;
      if (slot.kind === 'original') {
        yield this._base.getSerializedRecordView(slot.index);
      } else {
        yield serializeMarcBinary([slot.record]);
      }
    }
  }

  // ========== Private helpers ==========

  private _invalidateMaps(): void {
    this._positionMapDirty = true;
    this._slotOfId = null;
    this._positionOfSlot = null;
  }

  private _ensureIdMaps(): { slotOfId: Int32Array; positionOfSlot: Int32Array } {
    if (this._slotOfId === null || this._positionOfSlot === null) {
      const slotOfId = new Int32Array(this._nextId).fill(-1);
      const positionOfSlot = new Int32Array(this._slots.length).fill(-1);
      let position = 0;
      for (let i = 0; i < this._slots.length; i++) {
        const slot = this._slots[i]!;
        slotOfId[slot.id] = i;
        if (slot.kind !== 'deleted') positionOfSlot[i] = position++;
      }
      this._slotOfId = slotOfId;
      this._positionOfSlot = positionOfSlot;
    }
    return { slotOfId: this._slotOfId, positionOfSlot: this._positionOfSlot };
  }

  private _slotIndexOfId(id: RecordId): number {
    if (!Number.isInteger(id) || id < 0 || id >= this._nextId) return -1;
    return this._ensureIdMaps().slotOfId[id]!;
  }

  private _ensurePositionMap(): number[] {
    if (this._positionMap === null || this._positionMapDirty) {
      const map: number[] = [];
      for (let i = 0; i < this._slots.length; i++) {
        if (this._slots[i]!.kind !== 'deleted') map.push(i);
      }
      this._positionMap = map;
      this._positionMapDirty = false;
    }
    return this._positionMap;
  }

  private _slotIndexAt(position: number): number {
    const map = this._ensurePositionMap();
    return Number.isInteger(position) && position >= 0 && position < map.length
      ? map[position]!
      : -1;
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
    return this._base.getRecord(slot.index);
  }
}
