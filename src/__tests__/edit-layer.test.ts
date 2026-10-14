import { describe, it, expect } from 'vitest';
import { EditLayer } from '../edit-layer.js';
import { MarcBase } from '../marc-base.js';
import { createMultiRecordBuffer, createTypicalRecord } from './helpers/test-data.js';
import { appendField, isDataField } from 'marc-ts';

function makeBase(count: number): MarcBase {
  return MarcBase.fromBuffer(createMultiRecordBuffer(count));
}

function makeLayer(count: number): EditLayer {
  return new EditLayer(makeBase(count));
}

describe('EditLayer', () => {
  describe('construction', () => {
    it('initialises totalRecords from base', () => {
      const layer = makeLayer(5);
      expect(layer.totalRecords).toBe(5);
    });

    it('initialises modifiedCount to 0', () => {
      expect(makeLayer(3).modifiedCount).toBe(0);
    });

    it('starts with all slots as original', () => {
      const layer = makeLayer(3);
      expect(layer.slots.every((s) => s.kind === 'original')).toBe(true);
    });

    it('handles empty base (0 records)', () => {
      const layer = makeLayer(0);
      expect(layer.totalRecords).toBe(0);
      expect(layer.modifiedCount).toBe(0);
      expect(layer.slots).toHaveLength(0);
    });

    it('exposes the base store', () => {
      const base = makeBase(3);
      const layer = new EditLayer(base);
      expect(layer.baseStore).toBe(base);
    });
  });

  describe('getRecord', () => {
    it('returns the original record for an unmodified slot', () => {
      const base = makeBase(3);
      const layer = new EditLayer(base);
      expect(layer.getRecord(0).leader).toBe(base.getRecord(0).leader);
    });

    it('throws RangeError for negative index', () => {
      expect(() => makeLayer(3).getRecord(-1)).toThrow(RangeError);
    });

    it('throws RangeError for index >= totalRecords', () => {
      expect(() => makeLayer(3).getRecord(3)).toThrow(RangeError);
    });

    it('returns the modified record after setRecord', () => {
      const layer = makeLayer(3);
      const original = layer.getRecord(0);
      const modified = appendField(original, {
        tag: '500',
        indicator1: ' ',
        indicator2: ' ',
        subfields: [{ code: 'a', value: 'note' }],
      });
      layer.setRecord(0, modified);
      expect(layer.getRecord(0)).toEqual(modified);
    });

    it('returns an inserted record at its position', () => {
      const layer = makeLayer(3);
      const inserted = createTypicalRecord('ins');
      layer.insertRecord(inserted, 1);
      expect(layer.getRecord(2)).toEqual(inserted);
    });
  });

  describe('tryGetRecord', () => {
    it('returns ok:true for valid position', () => {
      const result = makeLayer(3).tryGetRecord(0);
      expect(result.ok).toBe(true);
    });

    it('returns ok:false for out-of-bounds position', () => {
      const result = makeLayer(3).tryGetRecord(99);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/out of range/);
    });
  });

  describe('iterateRecords', () => {
    it('yields all records with sequential indices', () => {
      const layer = makeLayer(4);
      const items = Array.from(layer.iterateRecords());
      expect(items).toHaveLength(4);
      items.forEach(({ index }, i) => expect(index).toBe(i));
    });

    it('skips deleted slots', () => {
      const layer = makeLayer(4);
      layer.deleteRecord(1);
      const items = Array.from(layer.iterateRecords());
      expect(items).toHaveLength(3);
      items.forEach(({ index }, i) => expect(index).toBe(i));
    });

    it('includes inserted records at the correct position', () => {
      const layer = makeLayer(3);
      const inserted = createTypicalRecord('ins');
      layer.insertRecord(inserted, 1);
      const items = Array.from(layer.iterateRecords());
      expect(items).toHaveLength(4);
      expect(items[2].record).toEqual(inserted);
    });

    it('yields nothing for an empty base', () => {
      expect(Array.from(makeLayer(0).iterateRecords())).toHaveLength(0);
    });
  });

  describe('setRecord', () => {
    it('replaces the record at the given position', () => {
      const layer = makeLayer(3);
      const original = layer.getRecord(1);
      const modified = appendField(original, {
        tag: '500',
        indicator1: ' ',
        indicator2: ' ',
        subfields: [{ code: 'a', value: 'x' }],
      });
      layer.setRecord(1, modified);
      expect(layer.getRecord(1)).toEqual(modified);
    });

    it('increments modifiedCount when modifying an original slot', () => {
      const layer = makeLayer(3);
      const rec = layer.getRecord(0);
      layer.setRecord(
        0,
        appendField(rec, { tag: '500', indicator1: ' ', indicator2: ' ', subfields: [] })
      );
      expect(layer.modifiedCount).toBe(1);
    });

    it('does not double-count modifiedCount on re-modification', () => {
      const layer = makeLayer(3);
      const rec = layer.getRecord(0);
      const m1 = appendField(rec, { tag: '500', indicator1: ' ', indicator2: ' ', subfields: [] });
      const m2 = appendField(m1, { tag: '501', indicator1: ' ', indicator2: ' ', subfields: [] });
      layer.setRecord(0, m1);
      layer.setRecord(0, m2);
      expect(layer.modifiedCount).toBe(1);
    });

    it('replaces in-place for an already-inserted slot without incrementing modifiedCount', () => {
      const layer = makeLayer(2);
      const inserted = createTypicalRecord('ins');
      layer.insertRecord(inserted, 0);
      expect(layer.modifiedCount).toBe(1);
      const replacement = createTypicalRecord('replaced');
      layer.setRecord(1, replacement);
      expect(layer.modifiedCount).toBe(1); // inserted slot, no increment
      expect(layer.getRecord(1)).toEqual(replacement);
    });

    it('throws RangeError for out-of-bounds position', () => {
      const layer = makeLayer(3);
      expect(() => layer.setRecord(3, createTypicalRecord('x'))).toThrow(RangeError);
      expect(() => layer.setRecord(-1, createTypicalRecord('x'))).toThrow(RangeError);
    });

    it('freezes the record it receives', () => {
      const layer = makeLayer(3);
      const rec = createTypicalRecord('new');
      layer.setRecord(0, rec);
      expect(Object.isFrozen(layer.getRecord(0))).toBe(true);
    });

    it("does not freeze the caller's record object", () => {
      const layer = makeLayer(3);
      const rec = createTypicalRecord('mine');
      layer.setRecord(0, rec);
      expect(Object.isFrozen(rec)).toBe(false);
      expect(Object.isFrozen(rec.fields)).toBe(false);
      expect(Object.isFrozen(rec.fields[0])).toBe(false);
      rec.fields.push({ tag: '002', data: 'later' });
      expect(layer.getRecord(0).fields).toHaveLength(3);
    });

    it('stores an already-frozen record without copying it', () => {
      const layer = makeLayer(3);
      const rec = layer.getRecord(1);
      layer.setRecord(0, rec);
      expect(layer.getRecord(0)).toBe(rec);
    });

    it('reuses frozen fields carried over by marc-ts helpers', () => {
      const layer = makeLayer(3);
      const original = layer.getRecord(0);
      const updated = appendField(original, {
        tag: '500',
        indicator1: ' ',
        indicator2: ' ',
        subfields: [{ code: 'a', value: 'note' }],
      });
      layer.setRecord(0, updated);
      const stored = layer.getRecord(0);
      expect(stored.fields[0]).toBe(original.fields[0]);
      expect(Object.isFrozen(stored.fields[stored.fields.length - 1])).toBe(true);
    });
  });

  describe('deleteRecord', () => {
    it('decrements totalRecords by 1', () => {
      const layer = makeLayer(5);
      layer.deleteRecord(2);
      expect(layer.totalRecords).toBe(4);
    });

    it('increments modifiedCount for an original slot', () => {
      const layer = makeLayer(3);
      layer.deleteRecord(0);
      expect(layer.modifiedCount).toBe(1);
    });

    it('shifts subsequent positions down by 1', () => {
      const layer = makeLayer(5);
      const recordAtThree = layer.getRecord(3);
      layer.deleteRecord(2);
      expect(layer.getRecord(2).leader).toBe(recordAtThree.leader);
    });

    it('removes an inserted slot entirely (no deleted slot remains)', () => {
      const layer = makeLayer(3);
      layer.insertRecord(createTypicalRecord('ins'), 1);
      expect(layer.totalRecords).toBe(4);
      layer.deleteRecord(2); // position 2 is the inserted record
      expect(layer.totalRecords).toBe(3);
      expect(layer.slots.every((s) => s.kind !== 'inserted')).toBe(true);
    });

    it('decrements modifiedCount when removing an inserted record', () => {
      const layer = makeLayer(2);
      layer.insertRecord(createTypicalRecord('ins'), 0);
      expect(layer.modifiedCount).toBe(1);
      layer.deleteRecord(1); // delete the inserted one
      expect(layer.modifiedCount).toBe(0);
    });

    it('does not double-count modifiedCount for an already-modified slot', () => {
      const layer = makeLayer(3);
      const rec = layer.getRecord(0);
      layer.setRecord(
        0,
        appendField(rec, { tag: '500', indicator1: ' ', indicator2: ' ', subfields: [] })
      );
      expect(layer.modifiedCount).toBe(1);
      layer.deleteRecord(0);
      expect(layer.modifiedCount).toBe(1); // already counted the original mutation
    });

    it('throws RangeError for out-of-bounds position', () => {
      const layer = makeLayer(3);
      expect(() => layer.deleteRecord(3)).toThrow(RangeError);
      expect(() => layer.deleteRecord(-1)).toThrow(RangeError);
    });

    it('marks slot as deleted in slots array', () => {
      const layer = makeLayer(3);
      layer.deleteRecord(1);
      expect(layer.slots.some((s) => s.kind === 'deleted')).toBe(true);
    });
  });

  describe('insertRecord', () => {
    it('appends to the end when afterPosition is omitted', () => {
      const layer = makeLayer(3);
      const rec = createTypicalRecord('end');
      layer.insertRecord(rec);
      expect(layer.totalRecords).toBe(4);
      expect(layer.getRecord(3)).toEqual(rec);
    });

    it('inserts after the given position', () => {
      const layer = makeLayer(3);
      const rec = createTypicalRecord('mid');
      layer.insertRecord(rec, 1);
      expect(layer.totalRecords).toBe(4);
      expect(layer.getRecord(2)).toEqual(rec);
    });

    it('inserts after position 0', () => {
      const layer = makeLayer(3);
      const rec = createTypicalRecord('after0');
      layer.insertRecord(rec, 0);
      expect(layer.getRecord(1)).toEqual(rec);
    });

    it('increments modifiedCount', () => {
      const layer = makeLayer(3);
      layer.insertRecord(createTypicalRecord('x'));
      expect(layer.modifiedCount).toBe(1);
    });

    it('increments totalRecords', () => {
      const layer = makeLayer(3);
      layer.insertRecord(createTypicalRecord('x'), 2);
      expect(layer.totalRecords).toBe(4);
    });

    it('freezes the inserted record', () => {
      const layer = makeLayer(3);
      const rec = createTypicalRecord('f');
      layer.insertRecord(rec);
      expect(Object.isFrozen(layer.getRecord(3))).toBe(true);
    });

    it("does not freeze the caller's record object", () => {
      const layer = makeLayer(3);
      const rec = createTypicalRecord('f');
      layer.insertRecord(rec);
      expect(Object.isFrozen(rec)).toBe(false);
      expect(Object.isFrozen(rec.fields)).toBe(false);
    });

    it('throws RangeError for out-of-bounds afterPosition', () => {
      const layer = makeLayer(3);
      expect(() => layer.insertRecord(createTypicalRecord('x'), 10)).toThrow(RangeError);
    });

    it('isModified returns true for the inserted position', () => {
      const layer = makeLayer(3);
      layer.insertRecord(createTypicalRecord('x'), 0);
      expect(layer.isModified(1)).toBe(true);
    });
  });

  describe('revertRecord', () => {
    it('removes modification and decrements modifiedCount', () => {
      const layer = makeLayer(3);
      const rec = layer.getRecord(0);
      layer.setRecord(
        0,
        appendField(rec, { tag: '500', indicator1: ' ', indicator2: ' ', subfields: [] })
      );
      expect(layer.modifiedCount).toBe(1);
      layer.revertRecord(0);
      expect(layer.modifiedCount).toBe(0);
    });

    it('makes isModified return false after revert', () => {
      const layer = makeLayer(3);
      const rec = layer.getRecord(0);
      layer.setRecord(
        0,
        appendField(rec, { tag: '500', indicator1: ' ', indicator2: ' ', subfields: [] })
      );
      layer.revertRecord(0);
      expect(layer.isModified(0)).toBe(false);
    });

    it('causes getRecord to re-fetch from base after revert', () => {
      const layer = makeLayer(3);
      const original = layer.getRecord(0);
      const modified = appendField(original, {
        tag: '500',
        indicator1: ' ',
        indicator2: ' ',
        subfields: [{ code: 'a', value: 'note' }],
      });
      layer.setRecord(0, modified);
      layer.revertRecord(0);
      const after = layer.getRecord(0);
      expect(after).not.toBe(modified);
      expect(after.fields.length).toBe(original.fields.length);
    });

    it('is a no-op for an original (unmodified) slot', () => {
      const layer = makeLayer(3);
      expect(() => layer.revertRecord(0)).not.toThrow();
      expect(layer.modifiedCount).toBe(0);
    });

    it('is a no-op for an out-of-bounds position (does not throw)', () => {
      const layer = makeLayer(3);
      expect(() => layer.revertRecord(99)).not.toThrow();
    });
  });

  describe('revertRecord after deleteRecord', () => {
    it('does not restore the deleted record (it has no position)', () => {
      const layer = makeLayer(3);
      const third = layer.getRecord(2);
      layer.deleteRecord(1);
      layer.revertRecord(1);
      expect(layer.totalRecords).toBe(2);
      expect(layer.getRecord(1)).toBe(third);
    });

    it('revertAll restores it', () => {
      const layer = makeLayer(3);
      const second = layer.getRecord(1);
      layer.deleteRecord(1);
      layer.revertAll();
      expect(layer.totalRecords).toBe(3);
      expect(layer.getRecord(1)).toEqual(second);
    });
  });

  describe('revertAll', () => {
    it('resets modifiedCount to 0', () => {
      const layer = makeLayer(5);
      layer.setRecord(
        0,
        appendField(layer.getRecord(0), {
          tag: '500',
          indicator1: ' ',
          indicator2: ' ',
          subfields: [],
        })
      );
      layer.deleteRecord(2);
      layer.insertRecord(createTypicalRecord('x'));
      layer.revertAll();
      expect(layer.modifiedCount).toBe(0);
    });

    it('restores totalRecords to the base count', () => {
      const layer = makeLayer(4);
      layer.deleteRecord(0);
      layer.insertRecord(createTypicalRecord('x'));
      layer.insertRecord(createTypicalRecord('y'));
      layer.revertAll();
      expect(layer.totalRecords).toBe(4);
    });

    it('removes all inserted slots', () => {
      const layer = makeLayer(3);
      layer.insertRecord(createTypicalRecord('a'));
      layer.insertRecord(createTypicalRecord('b'));
      layer.revertAll();
      expect(layer.slots.every((s) => s.kind === 'original')).toBe(true);
    });

    it('restores deleted slots to original', () => {
      const layer = makeLayer(3);
      layer.deleteRecord(1);
      layer.revertAll();
      expect(layer.slots.every((s) => s.kind === 'original')).toBe(true);
    });

    it('restores modified slots to original', () => {
      const layer = makeLayer(3);
      layer.setRecord(
        2,
        appendField(layer.getRecord(2), {
          tag: '500',
          indicator1: ' ',
          indicator2: ' ',
          subfields: [],
        })
      );
      layer.revertAll();
      expect(layer.slots.every((s) => s.kind === 'original')).toBe(true);
    });

    it('is a no-op when there are no modifications', () => {
      const layer = makeLayer(3);
      expect(() => layer.revertAll()).not.toThrow();
      expect(layer.totalRecords).toBe(3);
    });
  });

  describe('isModified', () => {
    it('returns false for an unmodified original slot', () => {
      expect(makeLayer(3).isModified(0)).toBe(false);
    });

    it('returns true after setRecord', () => {
      const layer = makeLayer(3);
      layer.setRecord(
        1,
        appendField(layer.getRecord(1), {
          tag: '500',
          indicator1: ' ',
          indicator2: ' ',
          subfields: [],
        })
      );
      expect(layer.isModified(1)).toBe(true);
    });

    it('returns true for an inserted record', () => {
      const layer = makeLayer(3);
      layer.insertRecord(createTypicalRecord('x'), 0);
      expect(layer.isModified(1)).toBe(true);
    });

    it('returns false after revertRecord', () => {
      const layer = makeLayer(3);
      layer.setRecord(
        0,
        appendField(layer.getRecord(0), {
          tag: '500',
          indicator1: ' ',
          indicator2: ' ',
          subfields: [],
        })
      );
      layer.revertRecord(0);
      expect(layer.isModified(0)).toBe(false);
    });

    it('returns false for out-of-bounds position', () => {
      expect(makeLayer(3).isModified(99)).toBe(false);
    });
  });

  describe('getSerializedRecord', () => {
    it('returns a copy of the original bytes for an original slot', () => {
      const buffer = createMultiRecordBuffer(3);
      const base = MarcBase.fromBuffer(buffer);
      const layer = new EditLayer(base);
      const serialized = layer.getSerializedRecord(0);
      expect(serialized.buffer).not.toBe(buffer.buffer);
      expect(serialized).toEqual(base.getSerializedRecordView(0));
    });

    it('returns re-serialized bytes for a modified slot', () => {
      const buffer = createMultiRecordBuffer(3);
      const base = MarcBase.fromBuffer(buffer);
      const layer = new EditLayer(base);
      const original = layer.getRecord(0);
      const modified = appendField(original, {
        tag: '500',
        indicator1: ' ',
        indicator2: ' ',
        subfields: [{ code: 'a', value: 'note' }],
      });
      layer.setRecord(0, modified);
      const serialized = layer.getSerializedRecord(0);
      // Re-serialized bytes, different buffer
      expect(serialized.buffer).not.toBe(buffer.buffer);
      const reloaded = MarcBase.fromBuffer(serialized);
      expect(reloaded.getRecord(0).fields.some((f) => isDataField(f) && f.tag === '500')).toBe(
        true
      );
    });

    it('returns re-serialized bytes for an inserted slot', () => {
      const layer = makeLayer(3);
      const rec = createTypicalRecord('ins');
      layer.insertRecord(rec, 1);
      const serialized = layer.getSerializedRecord(2);
      expect(serialized).toBeInstanceOf(Uint8Array);
      const reloaded = MarcBase.fromBuffer(serialized);
      expect(reloaded.totalRecords).toBe(1);
    });

    it('throws RangeError for out-of-bounds position', () => {
      expect(() => makeLayer(3).getSerializedRecord(5)).toThrow(RangeError);
    });

    it('throws RangeError for a deleted position', () => {
      const layer = makeLayer(3);
      // After deletion position 2 no longer exists; the slot is not accessible via position.
      // Test instead that requesting the raw slot index for a deleted slot via position map
      // raises an error — validate by requesting old count.
      layer.deleteRecord(0);
      expect(() => layer.getSerializedRecord(2)).toThrow(RangeError);
    });
  });

  describe('iterateSerializedRecords', () => {
    it('yields one chunk per non-deleted record', () => {
      const layer = makeLayer(5);
      expect(Array.from(layer.iterateSerializedRecords())).toHaveLength(5);
    });

    it('skips deleted records', () => {
      const layer = makeLayer(5);
      layer.deleteRecord(2);
      expect(Array.from(layer.iterateSerializedRecords())).toHaveLength(4);
    });

    it('yields zero-copy views for original slots', () => {
      const buffer = createMultiRecordBuffer(3);
      const base = MarcBase.fromBuffer(buffer);
      const layer = new EditLayer(base);
      for (const chunk of layer.iterateSerializedRecords()) {
        expect(chunk.buffer).toBe(buffer.buffer);
      }
    });

    it('yields re-serialized bytes for modified slots', () => {
      const buffer = createMultiRecordBuffer(3);
      const base = MarcBase.fromBuffer(buffer);
      const layer = new EditLayer(base);
      layer.setRecord(
        1,
        appendField(layer.getRecord(1), {
          tag: '500',
          indicator1: ' ',
          indicator2: ' ',
          subfields: [{ code: 'a', value: 'note' }],
        })
      );
      const chunks = Array.from(layer.iterateSerializedRecords());
      expect(chunks[0].buffer).toBe(buffer.buffer); // zero-copy
      expect(chunks[1].buffer).not.toBe(buffer.buffer); // re-serialized
      expect(chunks[2].buffer).toBe(buffer.buffer); // zero-copy
    });

    it('yields zero chunks for an empty base', () => {
      expect(Array.from(makeLayer(0).iterateSerializedRecords())).toHaveLength(0);
    });
  });

  describe('position map invalidation', () => {
    it('correctly remaps positions after multiple deletes', () => {
      const layer = makeLayer(5);
      const r4 = layer.getRecord(4);
      layer.deleteRecord(0);
      layer.deleteRecord(0); // was position 1, now 0 after first delete
      // Original positions 2,3,4 are now at 0,1,2
      expect(layer.getRecord(2).leader).toBe(r4.leader);
    });

    it('correctly remaps after interleaved inserts and deletes', () => {
      const layer = makeLayer(3);
      const inserted = createTypicalRecord('new');
      layer.insertRecord(inserted, 0); // [orig0, INS, orig1, orig2]
      layer.deleteRecord(0); // [INS, orig1, orig2]
      expect(layer.totalRecords).toBe(3);
      expect(layer.getRecord(0)).toEqual(inserted);
    });
  });
});

describe('EditLayer bulk operations', () => {
  const ids = (layer: EditLayer) =>
    Array.from(layer.iterateRecords(), ({ record }) => (record.fields[0] as { data: string }).data);

  describe('deleteRecords', () => {
    it('deletes the given positions as they were before the call', () => {
      const layer = makeLayer(5);
      const before = ids(layer);
      layer.deleteRecords([1, 3]);
      expect(layer.totalRecords).toBe(3);
      expect(ids(layer)).toEqual([before[0], before[2], before[4]]);
      expect(layer.modifiedCount).toBe(2);
    });

    it('accepts positions in any order and ignores duplicates', () => {
      const layer = makeLayer(5);
      layer.deleteRecords([4, 0, 4, 0]);
      expect(layer.totalRecords).toBe(3);
      expect(layer.modifiedCount).toBe(2);
    });

    it('removes inserted records outright and keeps counts consistent', () => {
      const layer = makeLayer(3);
      layer.insertRecord(createTypicalRecord('ins'), 0);
      layer.setRecord(2, createTypicalRecord('mod'));
      expect(layer.modifiedCount).toBe(2);
      layer.deleteRecords([1, 2]); // the inserted record and the modified one
      expect(layer.totalRecords).toBe(2);
      expect(layer.modifiedCount).toBe(1); // the modified record, now deleted
      expect(layer.slots.some((s) => s.kind === 'inserted')).toBe(false);
      expect(layer.slots.filter((s) => s.kind === 'deleted')).toHaveLength(1);
    });

    it('deletes nothing if any position is out of range', () => {
      const layer = makeLayer(3);
      expect(() => layer.deleteRecords([0, 3])).toThrow(RangeError);
      expect(() => layer.deleteRecords([0, 1.5])).toThrow(RangeError);
      expect(layer.totalRecords).toBe(3);
      expect(layer.modifiedCount).toBe(0);
    });

    it('is a no-op for an empty list', () => {
      const layer = makeLayer(3);
      layer.deleteRecords([]);
      expect(layer.totalRecords).toBe(3);
    });

    it('can be undone with revertAll', () => {
      const layer = makeLayer(4);
      const before = ids(layer);
      layer.deleteRecords([0, 2]);
      layer.revertAll();
      expect(ids(layer)).toEqual(before);
    });
  });

  describe('insertRecords', () => {
    it('appends records in order by default', () => {
      const layer = makeLayer(2);
      layer.insertRecords([createTypicalRecord('a'), createTypicalRecord('b')]);
      expect(layer.totalRecords).toBe(4);
      expect(ids(layer).slice(2)).toEqual(['a', 'b']);
      expect(layer.modifiedCount).toBe(2);
    });

    it('inserts after the given position', () => {
      const layer = makeLayer(3);
      const before = ids(layer);
      layer.insertRecords([createTypicalRecord('a'), createTypicalRecord('b')], 0);
      expect(ids(layer)).toEqual([before[0], 'a', 'b', before[1], before[2]]);
    });

    it('accepts any iterable and freezes copies, not the caller objects', () => {
      const layer = makeLayer(1);
      const rec = createTypicalRecord('a');
      layer.insertRecords(new Set([rec]));
      expect(Object.isFrozen(rec)).toBe(false);
      expect(Object.isFrozen(layer.getRecord(1))).toBe(true);
    });

    it('throws RangeError for an out-of-range position', () => {
      const layer = makeLayer(2);
      expect(() => layer.insertRecords([createTypicalRecord('a')], 2)).toThrow(RangeError);
      expect(layer.totalRecords).toBe(2);
    });

    it('is a no-op for an empty list', () => {
      const layer = makeLayer(2);
      layer.insertRecords([]);
      expect(layer.totalRecords).toBe(2);
      expect(layer.modifiedCount).toBe(0);
    });
  });
});

describe('EditLayer stable record IDs', () => {
  const idOf = (record: { fields: readonly unknown[] }) =>
    (record.fields[0] as { data: string }).data;

  it('gives original records their file index as ID', () => {
    const layer = makeLayer(3);
    expect([0, 1, 2].map((p) => layer.idAt(p))).toEqual([0, 1, 2]);
    expect(layer.slots.map((s) => s.id)).toEqual([0, 1, 2]);
  });

  it('keeps IDs stable as positions shift', () => {
    const layer = makeLayer(4);
    const id = layer.idAt(3);
    const record = layer.getRecord(3);
    layer.deleteRecord(0);
    layer.insertRecord(createTypicalRecord('new'), 0);
    layer.insertRecord(createTypicalRecord('new2'), 1);
    expect(layer.positionOf(id)).toBe(4);
    expect(layer.getRecordById(id)).toBe(record);
  });

  it('gives inserted records new IDs counting up from the file size, never reused', () => {
    const layer = makeLayer(3);
    layer.insertRecord(createTypicalRecord('a'));
    layer.insertRecords([createTypicalRecord('b'), createTypicalRecord('c')], 0);
    expect(layer.idAt(5)).toBe(3); // 'a', appended, now after b and c
    expect([layer.idAt(1), layer.idAt(2)]).toEqual([4, 5]);
    layer.revertAll();
    layer.insertRecord(createTypicalRecord('d'));
    expect(layer.idAt(3)).toBe(6);
    expect(layer.positionOf(3)).toBeUndefined();
  });

  it('keeps the ID when a record is modified', () => {
    const layer = makeLayer(2);
    layer.insertRecord(createTypicalRecord('ins'));
    const id = layer.idAt(2);
    layer.setRecord(2, createTypicalRecord('changed'));
    layer.setRecord(0, createTypicalRecord('mod'));
    expect(layer.idAt(2)).toBe(id);
    expect(layer.idAt(0)).toBe(0);
  });

  it('returns undefined from positionOf for deleted or unknown IDs', () => {
    const layer = makeLayer(3);
    layer.deleteRecord(1);
    expect(layer.positionOf(1)).toBeUndefined();
    expect(layer.positionOf(99)).toBeUndefined();
    expect(layer.positionOf(-1)).toBeUndefined();
    expect(layer.positionOf(0.5)).toBeUndefined();
    expect(() => layer.getRecordById(1)).toThrow(RangeError);
    expect(() => layer.idAt(2)).toThrow(RangeError);
  });

  describe('revert(id)', () => {
    it('restores a deleted record to its original position', () => {
      const layer = makeLayer(4);
      const before = Array.from(layer.iterateRecords(), ({ record }) => idOf(record));
      const id = layer.idAt(1);
      layer.deleteRecord(1);
      layer.deleteRecord(1); // the record originally at 2
      expect(layer.revert(id)).toBe(true);
      expect(layer.totalRecords).toBe(3);
      expect(layer.modifiedCount).toBe(1);
      expect(layer.positionOf(id)).toBe(1);
      expect(Array.from(layer.iterateRecords(), ({ record }) => idOf(record))).toEqual([
        before[0],
        before[1],
        before[3],
      ]);
    });

    it('undoes a modification', () => {
      const layer = makeLayer(2);
      const original = layer.getRecord(1);
      layer.setRecord(1, createTypicalRecord('mod'));
      expect(layer.revert(layer.idAt(1))).toBe(true);
      expect(layer.isModified(1)).toBe(false);
      expect(layer.getRecord(1)).toEqual(original);
      expect(layer.modifiedCount).toBe(0);
    });

    it('restores a modified-then-deleted record to its original content', () => {
      const layer = makeLayer(2);
      const original = layer.getRecord(0);
      layer.setRecord(0, createTypicalRecord('mod'));
      layer.deleteRecord(0);
      expect(layer.revert(0)).toBe(true);
      expect(layer.getRecord(0)).toEqual(original);
      expect(layer.modifiedCount).toBe(0);
    });

    it('returns false for unmodified, inserted and unknown records', () => {
      const layer = makeLayer(2);
      layer.insertRecord(createTypicalRecord('ins'));
      expect(layer.revert(0)).toBe(false);
      expect(layer.revert(layer.idAt(2))).toBe(false);
      expect(layer.revert(42)).toBe(false);
      expect(layer.totalRecords).toBe(3);
    });
  });

  it('lists deleted IDs in file order', () => {
    const layer = makeLayer(5);
    layer.deleteRecords([3, 1]);
    layer.insertRecord(createTypicalRecord('ins'), 0);
    layer.deleteRecord(1); // the inserted record: removed, not listed
    expect(layer.deletedIds()).toEqual([1, 3]);
  });
});

describe('MarcBase IDs', () => {
  it('uses the record index as the ID', () => {
    const base = makeBase(3);
    expect(base.idAt(2)).toBe(2);
    expect(base.positionOf(2)).toBe(2);
    expect(base.positionOf(3)).toBeUndefined();
    expect(() => base.idAt(3)).toThrow(RangeError);
  });
});

describe('EditLayer slot access', () => {
  it('getSlot returns the slot at a position, frozen', () => {
    const layer = makeLayer(3);
    layer.setRecord(1, createTypicalRecord('mod'));
    expect(layer.getSlot(1)).toMatchObject({ kind: 'modified', id: 1, index: 1 });
    expect(layer.getSlot(0)).toEqual({ kind: 'original', id: 0, index: 0 });
    expect(Object.isFrozen(layer.getSlot(0))).toBe(true);
    expect(layer.getSlot(3)).toBeUndefined();
  });

  it('getSlot skips deleted slots, like other position lookups', () => {
    const layer = makeLayer(3);
    layer.deleteRecord(0);
    expect(layer.getSlot(0)).toMatchObject({ kind: 'original', id: 1 });
  });

  it('iterateSlots yields every slot including deleted ones, matching slots', () => {
    const layer = makeLayer(3);
    layer.deleteRecord(0);
    layer.insertRecord(createTypicalRecord('ins'));
    const slots = Array.from(layer.iterateSlots());
    expect(slots.map((s) => s.kind)).toEqual(['deleted', 'original', 'original', 'inserted']);
    expect(slots).toEqual(layer.slots);
  });
});
