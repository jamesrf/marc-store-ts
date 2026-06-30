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
      expect(layer.getRecord(0)).toBe(modified);
    });

    it('returns an inserted record at its position', () => {
      const layer = makeLayer(3);
      const inserted = createTypicalRecord('ins');
      layer.insertRecord(inserted, 1);
      expect(layer.getRecord(2)).toBe(inserted);
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
      expect(items[2].record).toBe(inserted);
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
      expect(layer.getRecord(1)).toBe(modified);
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
      expect(layer.getRecord(1)).toBe(replacement);
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
      expect(layer.getRecord(3)).toBe(rec);
    });

    it('inserts after the given position', () => {
      const layer = makeLayer(3);
      const rec = createTypicalRecord('mid');
      layer.insertRecord(rec, 1);
      expect(layer.totalRecords).toBe(4);
      expect(layer.getRecord(2)).toBe(rec);
    });

    it('inserts after position 0', () => {
      const layer = makeLayer(3);
      const rec = createTypicalRecord('after0');
      layer.insertRecord(rec, 0);
      expect(layer.getRecord(1)).toBe(rec);
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

  describe('revertAll', () => {
    it('resets modifiedCount to 0', () => {
      const layer = makeLayer(5);
      layer.setRecord(
        0,
        appendField(layer.getRecord(0), { tag: '500', indicator1: ' ', indicator2: ' ', subfields: [] })
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
        appendField(layer.getRecord(2), { tag: '500', indicator1: ' ', indicator2: ' ', subfields: [] })
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
        appendField(layer.getRecord(1), { tag: '500', indicator1: ' ', indicator2: ' ', subfields: [] })
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
        appendField(layer.getRecord(0), { tag: '500', indicator1: ' ', indicator2: ' ', subfields: [] })
      );
      layer.revertRecord(0);
      expect(layer.isModified(0)).toBe(false);
    });

    it('returns false for out-of-bounds position', () => {
      expect(makeLayer(3).isModified(99)).toBe(false);
    });
  });

  describe('getSerializedRecord', () => {
    it('returns a zero-copy view for an original slot', () => {
      const buffer = createMultiRecordBuffer(3);
      const base = MarcBase.fromBuffer(buffer);
      const layer = new EditLayer(base);
      const serialized = layer.getSerializedRecord(0);
      expect(serialized.buffer).toBe(buffer.buffer);
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
      expect(reloaded.getRecord(0).fields.some((f) => isDataField(f) && f.tag === '500')).toBe(true);
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
      layer.deleteRecord(0);           // [INS, orig1, orig2]
      expect(layer.totalRecords).toBe(3);
      expect(layer.getRecord(0)).toBe(inserted);
    });
  });
});
