import { describe, it, expect } from 'vitest';
import { MarcFile } from '../record-store.js';
import { indexBuffer } from '../record-index.js';
import { createTypicalRecord, createMultiRecordBuffer } from './helpers/test-data.js';
import { appendField, isDataField } from 'marc-ts';

describe('MarcFile', () => {
  describe('construction', () => {
    it('creates store with valid buffer and index', () => {
      const buffer = createMultiRecordBuffer(10);
      const index = indexBuffer(buffer);
      const store = new MarcFile(buffer, index);
      expect(store.totalRecords).toBe(10);
      expect(store.modifiedCount).toBe(0);
    });

    it('handles empty file (0 records)', () => {
      const buffer = new Uint8Array(0);
      const index = indexBuffer(buffer);
      const store = new MarcFile(buffer, index);
      expect(store.totalRecords).toBe(0);
      expect(store.modifiedCount).toBe(0);
    });

    it('accepts custom cache capacity', () => {
      const buffer = createMultiRecordBuffer(5);
      const index = indexBuffer(buffer);
      const store = new MarcFile(buffer, index, 10);
      expect(store.totalRecords).toBe(5);
    });
  });

  describe('fromBuffer', () => {
    it('creates store from Uint8Array', () => {
      const buffer = createMultiRecordBuffer(5);
      const store = MarcFile.fromBuffer(buffer);
      expect(store.totalRecords).toBe(5);
    });

    it('creates store from ArrayBuffer', () => {
      const buffer = createMultiRecordBuffer(5);
      const store = MarcFile.fromBuffer(buffer);
      expect(store.totalRecords).toBe(5);
    });

    it('returns same records as two-step construction', () => {
      const buffer = createMultiRecordBuffer(5);
      const index = indexBuffer(buffer);
      const storeA = new MarcFile(buffer, index);
      const storeB = MarcFile.fromBuffer(buffer);
      for (let i = 0; i < 5; i++) {
        expect(storeA.getRecord(i).leader).toBe(storeB.getRecord(i).leader);
      }
    });

    it('accepts custom cache capacity', () => {
      const buffer = createMultiRecordBuffer(5);
      const store = MarcFile.fromBuffer(buffer, 50);
      expect(store.totalRecords).toBe(5);
    });

    it('handles Uint8Array subarray views with non-zero byteOffset', () => {
      const marcData = createMultiRecordBuffer(3);
      const padding = 256;
      const wrapper = new Uint8Array(padding + marcData.length + padding);
      wrapper.set(marcData, padding);
      const view = wrapper.subarray(padding, padding + marcData.length);

      const storeFromView = MarcFile.fromBuffer(view);
      const storeFromFull = MarcFile.fromBuffer(marcData);

      expect(storeFromView.totalRecords).toBe(storeFromFull.totalRecords);

      for (let i = 0; i < storeFromFull.totalRecords; i++) {
        const recordFromView = storeFromView.getRecord(i);
        const recordFromFull = storeFromFull.getRecord(i);
        expect(recordFromView.leader).toBe(recordFromFull.leader);

        const serializedFromView = storeFromView.getSerializedRecord(i);
        const serializedFromFull = storeFromFull.getSerializedRecord(i);
        expect(Array.from(serializedFromView)).toEqual(Array.from(serializedFromFull));
      }
    });
  });

  describe('getRecord', () => {
    it('parses record from buffer on first access', () => {
      const buffer = createMultiRecordBuffer(3);
      const store = MarcFile.fromBuffer(buffer);
      const record = store.getRecord(0);
      expect(record).toBeDefined();
      expect(record.leader).toBeDefined();
      expect(record.fields.length).toBeGreaterThan(0);
    });

    it('returns cached record on second access', () => {
      const buffer = createMultiRecordBuffer(3);
      const store = MarcFile.fromBuffer(buffer);
      const record1 = store.getRecord(0);
      const record2 = store.getRecord(0);
      expect(record2).toBe(record1);
    });

    it('returns modified record when set', () => {
      const buffer = createMultiRecordBuffer(3);
      const store = MarcFile.fromBuffer(buffer);
      const original = store.getRecord(0);
      const modified = appendField(original, {
        tag: '500',
        indicator1: ' ',
        indicator2: ' ',
        subfields: [{ code: 'a', value: 'Modified note' }],
      });
      store.setRecord(0, modified);
      expect(store.getRecord(0)).toEqual(modified);
    });

    it('throws RangeError for negative index', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
      expect(() => store.getRecord(-1)).toThrow(RangeError);
    });

    it('throws RangeError for index >= totalRecords', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
      expect(() => store.getRecord(3)).toThrow(RangeError);
      expect(() => store.getRecord(100)).toThrow(RangeError);
    });

    it('throws Error for malformed record', () => {
      const validBuffer = createMultiRecordBuffer(1);
      const index = indexBuffer(validBuffer);
      const corrupt = new Uint8Array(validBuffer);
      for (let i = 24; i < Math.min(50, corrupt.length); i++) corrupt[i] = 0xff;
      const store = new MarcFile(corrupt.buffer as ArrayBuffer, index);
      expect(() => store.getRecord(0)).toThrow('Parse failed');
    });
  });

  describe('tryGetRecord', () => {
    it('returns {ok: true, record} for valid index', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
      const result = store.tryGetRecord(0);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.record.fields.length).toBeGreaterThan(0);
    });

    it('returns {ok: false, error} for invalid index', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
      const result = store.tryGetRecord(100);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('out of range');
    });

    it('returns {ok: false, error} for malformed record', () => {
      const validBuffer = createMultiRecordBuffer(1);
      const index = indexBuffer(validBuffer);
      const corrupt = new Uint8Array(validBuffer);
      for (let i = 24; i < Math.min(50, corrupt.length); i++) corrupt[i] = 0xff;
      const store = new MarcFile(corrupt.buffer as ArrayBuffer, index);
      const result = store.tryGetRecord(0);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('Parse failed');
    });
  });

  describe('iterateRecords', () => {
    it('yields all records with correct indices', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(5));
      const items = Array.from(store.iterateRecords());
      expect(items).toHaveLength(5);
      items.forEach(({ index }, i) => expect(index).toBe(i));
    });

    it('skips deleted records', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(5));
      store.deleteRecord(2);
      const items = Array.from(store.iterateRecords());
      expect(items).toHaveLength(4);
      items.forEach(({ index }, i) => expect(index).toBe(i));
    });

    it('includes inserted records at correct position', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
      const newRecord = createTypicalRecord('inserted');
      store.insertRecord(newRecord, 1);
      const items = Array.from(store.iterateRecords());
      expect(items).toHaveLength(4);
      expect(items[2].record).toEqual(newRecord);
    });
  });

  describe('setRecord', () => {
    it('adds record to overlay', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
      const original = store.getRecord(0);
      const modified = appendField(original, {
        tag: '500',
        indicator1: ' ',
        indicator2: ' ',
        subfields: [{ code: 'a', value: 'Test' }],
      });
      store.setRecord(0, modified);
      expect(store.modifiedCount).toBe(1);
      expect(store.isModified(0)).toBe(true);
    });

    it('throws RangeError for out-of-bounds index', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
      const record = createTypicalRecord('test');
      expect(() => store.setRecord(-1, record)).toThrow(RangeError);
      expect(() => store.setRecord(3, record)).toThrow(RangeError);
    });

    it('allows multiple modifications to same record', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
      const original = store.getRecord(0);
      const m1 = appendField(original, {
        tag: '500',
        indicator1: ' ',
        indicator2: ' ',
        subfields: [{ code: 'a', value: 'First' }],
      });
      store.setRecord(0, m1);
      const m2 = appendField(m1, {
        tag: '501',
        indicator1: ' ',
        indicator2: ' ',
        subfields: [{ code: 'a', value: 'Second' }],
      });
      store.setRecord(0, m2);
      expect(store.modifiedCount).toBe(1);
      expect(store.getRecord(0).fields.length).toBe(original.fields.length + 2);
    });
  });

  describe('deleteRecord', () => {
    it('reduces totalRecords by 1', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(5));
      store.deleteRecord(2);
      expect(store.totalRecords).toBe(4);
    });

    it('increases modifiedCount', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(5));
      store.deleteRecord(2);
      expect(store.modifiedCount).toBe(1);
    });

    it('shifts subsequent record positions down', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(5));
      const recordAtThree = store.getRecord(3);
      store.deleteRecord(2);
      expect(store.getRecord(2).leader).toBe(recordAtThree.leader);
    });

    it('skips deleted record in iterateSerializedRecords', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(5));
      store.deleteRecord(2);
      const chunks = Array.from(store.iterateSerializedRecords());
      expect(chunks).toHaveLength(4);
    });

    it('throws RangeError for out-of-bounds index', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
      expect(() => store.deleteRecord(3)).toThrow(RangeError);
    });

    it('removes inserted record entirely from slots', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
      store.insertRecord(createTypicalRecord('new'), 1);
      expect(store.totalRecords).toBe(4);
      store.deleteRecord(2); // the inserted one
      expect(store.totalRecords).toBe(3);
      expect(store.slots.every((s) => s.kind !== 'inserted')).toBe(true);
    });
  });

  describe('insertRecord', () => {
    it('inserts after specified position', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
      const newRecord = createTypicalRecord('inserted');
      store.insertRecord(newRecord, 1);
      expect(store.totalRecords).toBe(4);
      expect(store.getRecord(2)).toEqual(newRecord);
    });

    it('appends to end when no position given', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
      const newRecord = createTypicalRecord('appended');
      store.insertRecord(newRecord);
      expect(store.totalRecords).toBe(4);
      expect(store.getRecord(3)).toEqual(newRecord);
    });

    it('increases modifiedCount', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
      store.insertRecord(createTypicalRecord('new'));
      expect(store.modifiedCount).toBe(1);
    });

    it('includes inserted record in serialized output', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
      store.insertRecord(createTypicalRecord('new'), 1);
      const chunks = Array.from(store.iterateSerializedRecords());
      expect(chunks).toHaveLength(4);
    });

    it('throws RangeError for out-of-bounds afterPosition', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
      expect(() => store.insertRecord(createTypicalRecord('x'), 10)).toThrow(RangeError);
    });
  });

  describe('revertRecord', () => {
    it('removes record from overlay', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
      const original = store.getRecord(0);
      const modified = appendField(original, {
        tag: '500',
        indicator1: ' ',
        indicator2: ' ',
        subfields: [{ code: 'a', value: 'Test' }],
      });
      store.setRecord(0, modified);
      expect(store.modifiedCount).toBe(1);
      store.revertRecord(0);
      expect(store.modifiedCount).toBe(0);
      expect(store.isModified(0)).toBe(false);
    });

    it('re-parses from buffer after revert', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
      const original = store.getRecord(0);
      const modified = appendField(original, {
        tag: '500',
        indicator1: ' ',
        indicator2: ' ',
        subfields: [{ code: 'a', value: 'Test' }],
      });
      store.setRecord(0, modified);
      store.revertRecord(0);
      const retrieved = store.getRecord(0);
      expect(retrieved).not.toBe(modified);
      expect(retrieved.fields.length).toBe(original.fields.length);
    });
  });

  describe('isModified', () => {
    it('returns false for unmodified record', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
      expect(store.isModified(0)).toBe(false);
    });

    it('returns true after setRecord', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
      const record = store.getRecord(0);
      store.setRecord(
        0,
        appendField(record, {
          tag: '500',
          indicator1: ' ',
          indicator2: ' ',
          subfields: [{ code: 'a', value: 'x' }],
        })
      );
      expect(store.isModified(0)).toBe(true);
      expect(store.isModified(1)).toBe(false);
    });

    it('returns true for inserted record', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
      store.insertRecord(createTypicalRecord('new'), 1);
      expect(store.isModified(2)).toBe(true);
    });

    it('returns false after revertRecord', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
      const record = store.getRecord(0);
      store.setRecord(
        0,
        appendField(record, {
          tag: '500',
          indicator1: ' ',
          indicator2: ' ',
          subfields: [{ code: 'a', value: 'x' }],
        })
      );
      store.revertRecord(0);
      expect(store.isModified(0)).toBe(false);
    });
  });

  describe('iterateSerializedRecords', () => {
    it('yields all records in order', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(5));
      const chunks = Array.from(store.iterateSerializedRecords());
      expect(chunks).toHaveLength(5);
      chunks.forEach((c) => expect(c).toBeInstanceOf(Uint8Array));
    });

    it('serializes modified records from overlay', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
      const original = store.getRecord(1);
      const modified = appendField(original, {
        tag: '500',
        indicator1: ' ',
        indicator2: ' ',
        subfields: [{ code: 'a', value: 'Modified' }],
      });
      store.setRecord(1, modified);
      const chunks = Array.from(store.iterateSerializedRecords());
      expect(chunks).toHaveLength(3);
      const reloaded = MarcFile.fromBuffer(chunks[1]);
      expect(reloaded.getRecord(0).fields.some((f) => isDataField(f) && f.tag === '500')).toBe(
        true
      );
    });

    it('yields buffer views for unmodified records (zero-copy)', () => {
      const buffer = createMultiRecordBuffer(3);
      const store = MarcFile.fromBuffer(buffer);
      const chunks = Array.from(store.iterateSerializedRecords());
      expect(chunks[0].buffer).toBe(buffer.buffer);
      expect(chunks[1].buffer).toBe(buffer.buffer);
      expect(chunks[2].buffer).toBe(buffer.buffer);
    });

    it('handles empty file', () => {
      const store = MarcFile.fromBuffer(new Uint8Array(0));
      expect(Array.from(store.iterateSerializedRecords())).toHaveLength(0);
    });

    it('handles all-modified file', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
      for (let i = 0; i < 3; i++) {
        store.setRecord(
          i,
          appendField(store.getRecord(i), {
            tag: '500',
            indicator1: ' ',
            indicator2: ' ',
            subfields: [{ code: 'a', value: `Note ${i}` }],
          })
        );
      }
      expect(Array.from(store.iterateSerializedRecords())).toHaveLength(3);
      expect(store.modifiedCount).toBe(3);
    });
  });

  describe('record immutability', () => {
    it('freezes records parsed from buffer', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
      const record = store.getRecord(0);
      expect(Object.isFrozen(record)).toBe(true);
      expect(Object.isFrozen(record.fields)).toBe(true);
      for (const field of record.fields) {
        expect(Object.isFrozen(field)).toBe(true);
      }
    });

    it('throws TypeError when mutating a returned original record', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
      const record = store.getRecord(0);
      expect(() => {
        (record as Record<string, unknown>).leader = 'changed';
      }).toThrow(TypeError);
      expect(() => {
        (record.fields as unknown as { push: (v: unknown) => void }).push({
          tag: '999',
          data: 'bad',
        });
      }).toThrow(TypeError);
    });

    it('throws TypeError when mutating a returned modified record', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
      const original = store.getRecord(0);
      const modified = appendField(original, {
        tag: '500',
        indicator1: ' ',
        indicator2: ' ',
        subfields: [{ code: 'a', value: 'Test' }],
      });
      store.setRecord(0, modified);
      const retrieved = store.getRecord(0);
      expect(Object.isFrozen(retrieved)).toBe(true);
      expect(() => {
        (retrieved as Record<string, unknown>).leader = 'changed';
      }).toThrow(TypeError);
    });

    it('freezes inserted records', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
      const newRecord = createTypicalRecord('inserted');
      store.insertRecord(newRecord, 1);
      const retrieved = store.getRecord(2);
      expect(Object.isFrozen(retrieved)).toBe(true);
      expect(Object.isFrozen(retrieved.fields)).toBe(true);
    });

    it('allows setRecord with a new record after freeze', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
      const record = store.getRecord(0);
      const updated = appendField(record, {
        tag: '500',
        indicator1: ' ',
        indicator2: ' ',
        subfields: [{ code: 'a', value: 'Added via setRecord' }],
      });
      store.setRecord(0, updated);
      expect(store.getRecord(0).fields.length).toBe(record.fields.length + 1);
      expect(store.isModified(0)).toBe(true);
    });
  });

  describe('cache behavior', () => {
    it('caches parsed records up to capacity', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(5), 2);
      store.getRecord(0);
      store.getRecord(1);
      store.getRecord(2); // evicts 0
      const r1 = store.getRecord(2);
      const r2 = store.getRecord(2);
      expect(r2).toBe(r1);
    });

    it('respects LRU eviction policy', () => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(4), 2);
      const r0a = store.getRecord(0);
      const r1a = store.getRecord(1);
      const r0b = store.getRecord(0); // moves 0 to most-recent
      expect(r0b).toBe(r0a);
      store.getRecord(2); // evicts 1
      const r1b = store.getRecord(1);
      expect(r1b).not.toBe(r1a); // re-parsed
    });
  });
});

describe('MarcFile stable record IDs', () => {
  it('delegates the ID API to the edit layer', () => {
    const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
    const id = store.idAt(2);
    const record = store.getRecord(2);
    store.deleteRecord(0);
    expect(store.positionOf(id)).toBe(1);
    expect(store.getRecordById(id)).toBe(record);
    expect(store.deletedIds()).toEqual([0]);
    expect(store.revert(0)).toBe(true);
    expect(store.totalRecords).toBe(3);
    expect(store.deletedIds()).toEqual([]);
  });
});

describe('MarcFile slot access', () => {
  it('delegates getSlot and iterateSlots', () => {
    const store = MarcFile.fromBuffer(createMultiRecordBuffer(2));
    store.deleteRecord(0);
    expect(store.getSlot(0)).toMatchObject({ kind: 'original', id: 1 });
    expect(Array.from(store.iterateSlots()).map((s) => s.kind)).toEqual(['deleted', 'original']);
  });
});
