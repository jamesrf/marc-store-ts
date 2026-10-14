import { describe, it, expect } from 'vitest';
import { MarcBase, deepFreezeRecord } from '../marc-base.js';
import { indexBuffer } from '../record-index.js';
import { MarcFile } from '../record-store.js';
import { createMultiRecordBuffer, createTypicalRecord } from './helpers/test-data.js';

describe('deepFreezeRecord', () => {
  it('freezes the record object itself', () => {
    const record = createTypicalRecord('001');
    deepFreezeRecord(record);
    expect(Object.isFrozen(record)).toBe(true);
  });

  it('freezes the fields array', () => {
    const record = createTypicalRecord('001');
    deepFreezeRecord(record);
    expect(Object.isFrozen(record.fields)).toBe(true);
  });

  it('freezes each field', () => {
    const record = createTypicalRecord('001');
    deepFreezeRecord(record);
    for (const field of record.fields) {
      expect(Object.isFrozen(field)).toBe(true);
    }
  });

  it('freezes subfields on data fields', () => {
    const record = createTypicalRecord('001');
    deepFreezeRecord(record);
    for (const field of record.fields) {
      if ('subfields' in field) {
        expect(Object.isFrozen(field.subfields)).toBe(true);
        for (const sub of field.subfields) {
          expect(Object.isFrozen(sub)).toBe(true);
        }
      }
    }
  });

  it('returns the same record reference', () => {
    const record = createTypicalRecord('001');
    const result = deepFreezeRecord(record);
    expect(result).toBe(record);
  });

  it('prevents mutation of leader', () => {
    const record = createTypicalRecord('001');
    deepFreezeRecord(record);
    expect(() => {
      (record as Record<string, unknown>).leader = 'changed';
    }).toThrow(TypeError);
  });

  it('handles records with only control fields (no subfields)', () => {
    const record = { leader: '00000nam  2200000   4500', fields: [{ tag: '001', data: 'x' }] };
    deepFreezeRecord(record);
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.fields[0])).toBe(true);
  });
});

describe('MarcBase', () => {
  describe('constructor', () => {
    it('accepts Uint8Array and tracks byteOffset', () => {
      const buffer = createMultiRecordBuffer(3);
      const index = indexBuffer(buffer);
      const base = new MarcBase(buffer, index);
      expect(base.totalRecords).toBe(3);
    });

    it('accepts ArrayBuffer', () => {
      const bytes = createMultiRecordBuffer(3);
      const buffer = bytes.buffer as ArrayBuffer;
      const index = indexBuffer(bytes);
      const base = new MarcBase(buffer, index);
      expect(base.totalRecords).toBe(3);
    });

    it('handles non-zero byteOffset on a Uint8Array subarray', () => {
      const marcData = createMultiRecordBuffer(2);
      const padding = 128;
      const wrapper = new Uint8Array(padding + marcData.length);
      wrapper.set(marcData, padding);
      const view = wrapper.subarray(padding);
      const index = indexBuffer(view);
      const base = new MarcBase(view, index);
      expect(base.totalRecords).toBe(2);
      const record = base.getRecord(0);
      expect(record).toBeDefined();
    });

    it('uses custom cache capacity', () => {
      const buffer = createMultiRecordBuffer(5);
      const index = indexBuffer(buffer);
      const base = new MarcBase(buffer, index, 1);
      expect(base.totalRecords).toBe(5);
      // With capacity 1, accessing two records means the first is evicted.
      const r0 = base.getRecord(0);
      base.getRecord(1); // evicts 0
      const r0again = base.getRecord(0); // re-parsed
      expect(r0again).not.toBe(r0);
    });
  });

  describe('fromBuffer', () => {
    it('creates instance from Uint8Array', () => {
      const buffer = createMultiRecordBuffer(4);
      const base = MarcBase.fromBuffer(buffer);
      expect(base.totalRecords).toBe(4);
    });

    it('creates instance from ArrayBuffer', () => {
      const bytes = createMultiRecordBuffer(4);
      const base = MarcBase.fromBuffer(bytes.buffer as ArrayBuffer);
      expect(base.totalRecords).toBe(4);
    });

    it('produces same records as two-step construction', () => {
      const buffer = createMultiRecordBuffer(3);
      const index = indexBuffer(buffer);
      const a = new MarcBase(buffer, index);
      const b = MarcBase.fromBuffer(buffer);
      for (let i = 0; i < 3; i++) {
        expect(a.getRecord(i).leader).toBe(b.getRecord(i).leader);
      }
    });

    it('handles non-zero byteOffset subarray view', () => {
      const marcData = createMultiRecordBuffer(3);
      const padding = 256;
      const wrapper = new Uint8Array(padding + marcData.length + padding);
      wrapper.set(marcData, padding);
      const view = wrapper.subarray(padding, padding + marcData.length);

      const baseFromView = MarcBase.fromBuffer(view);
      const baseFromFull = MarcBase.fromBuffer(marcData);

      expect(baseFromView.totalRecords).toBe(baseFromFull.totalRecords);
      for (let i = 0; i < baseFromFull.totalRecords; i++) {
        expect(baseFromView.getRecord(i).leader).toBe(baseFromFull.getRecord(i).leader);
      }
    });
  });

  describe('totalRecords / indexCount', () => {
    it('returns 0 for empty buffer', () => {
      const base = MarcBase.fromBuffer(new Uint8Array(0));
      expect(base.totalRecords).toBe(0);
      expect(base.indexCount).toBe(0);
    });

    it('totalRecords equals indexCount', () => {
      const base = MarcBase.fromBuffer(createMultiRecordBuffer(7));
      expect(base.totalRecords).toBe(base.indexCount);
    });
  });

  describe('getRecord', () => {
    it('returns a frozen record', () => {
      const base = MarcBase.fromBuffer(createMultiRecordBuffer(2));
      const record = base.getRecord(0);
      expect(Object.isFrozen(record)).toBe(true);
    });

    it('returns the same object on repeated access (cached)', () => {
      const base = MarcBase.fromBuffer(createMultiRecordBuffer(2));
      expect(base.getRecord(0)).toBe(base.getRecord(0));
    });

    it('throws RangeError for negative index', () => {
      const base = MarcBase.fromBuffer(createMultiRecordBuffer(3));
      expect(() => base.getRecord(-1)).toThrow(RangeError);
    });

    it('throws RangeError for index equal to totalRecords', () => {
      const base = MarcBase.fromBuffer(createMultiRecordBuffer(3));
      expect(() => base.getRecord(3)).toThrow(RangeError);
    });

    it('throws RangeError for large out-of-bounds index', () => {
      const base = MarcBase.fromBuffer(createMultiRecordBuffer(3));
      expect(() => base.getRecord(999)).toThrow(RangeError);
    });

    it('throws Error with "Parse failed" message for corrupt record', () => {
      const valid = createMultiRecordBuffer(1);
      const index = indexBuffer(valid);
      const corrupt = new Uint8Array(valid);
      for (let i = 24; i < Math.min(50, corrupt.length); i++) corrupt[i] = 0xff;
      const base = new MarcBase(corrupt.buffer as ArrayBuffer, index);
      expect(() => base.getRecord(0)).toThrow(/Parse failed/);
    });

    it('includes offset in error message for corrupt record', () => {
      const valid = createMultiRecordBuffer(1);
      const index = indexBuffer(valid);
      const corrupt = new Uint8Array(valid);
      for (let i = 24; i < Math.min(50, corrupt.length); i++) corrupt[i] = 0xff;
      const base = new MarcBase(corrupt.buffer as ArrayBuffer, index);
      expect(() => base.getRecord(0)).toThrow(/offset 0/);
    });

    it('accesses last record correctly', () => {
      const base = MarcBase.fromBuffer(createMultiRecordBuffer(5));
      const record = base.getRecord(4);
      expect(record).toBeDefined();
      expect(record.fields.length).toBeGreaterThan(0);
    });
  });

  describe('tryGetRecord', () => {
    it('returns ok:true with record for valid index', () => {
      const base = MarcBase.fromBuffer(createMultiRecordBuffer(3));
      const result = base.tryGetRecord(0);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.record).toBeDefined();
    });

    it('returns ok:false with error string for out-of-bounds index', () => {
      const base = MarcBase.fromBuffer(createMultiRecordBuffer(3));
      const result = base.tryGetRecord(10);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/out of range/);
    });

    it('returns ok:false for corrupt record', () => {
      const valid = createMultiRecordBuffer(1);
      const index = indexBuffer(valid);
      const corrupt = new Uint8Array(valid);
      for (let i = 24; i < Math.min(50, corrupt.length); i++) corrupt[i] = 0xff;
      const base = new MarcBase(corrupt.buffer as ArrayBuffer, index);
      const result = base.tryGetRecord(0);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/Parse failed/);
    });
  });

  describe('iterateRecords', () => {
    it('yields all records with sequential indices', () => {
      const base = MarcBase.fromBuffer(createMultiRecordBuffer(5));
      const items = Array.from(base.iterateRecords());
      expect(items).toHaveLength(5);
      items.forEach(({ index }, i) => expect(index).toBe(i));
    });

    it('yields zero items for empty buffer', () => {
      const base = MarcBase.fromBuffer(new Uint8Array(0));
      expect(Array.from(base.iterateRecords())).toHaveLength(0);
    });

    it('yields records that are frozen', () => {
      const base = MarcBase.fromBuffer(createMultiRecordBuffer(2));
      for (const { record } of base.iterateRecords()) {
        expect(Object.isFrozen(record)).toBe(true);
      }
    });
  });

  describe('getSerializedRecord', () => {
    it('returns a copy, so writing to it cannot corrupt the store', () => {
      const buffer = createMultiRecordBuffer(3);
      const base = MarcBase.fromBuffer(buffer);
      const serialized = base.getSerializedRecord(0);
      expect(serialized).toBeInstanceOf(Uint8Array);
      expect(serialized.buffer).not.toBe(buffer.buffer);
      const leader = base.getRecord(0).leader;
      serialized.fill(0xff);
      base.evictFromCache(0);
      expect(base.getRecord(0).leader).toBe(leader);
    });

    it('getSerializedRecordView returns a zero-copy view', () => {
      const buffer = createMultiRecordBuffer(3);
      const base = MarcBase.fromBuffer(buffer);
      const view = base.getSerializedRecordView(0);
      expect(view.buffer).toBe(buffer.buffer);
      expect(view).toEqual(base.getSerializedRecord(0));
    });

    it('throws RangeError for negative index', () => {
      const base = MarcBase.fromBuffer(createMultiRecordBuffer(3));
      expect(() => base.getSerializedRecord(-1)).toThrow(RangeError);
    });

    it('throws RangeError for out-of-bounds index', () => {
      const base = MarcBase.fromBuffer(createMultiRecordBuffer(3));
      expect(() => base.getSerializedRecord(3)).toThrow(RangeError);
    });

    it('round-trips: serialized bytes re-parse to the same record', () => {
      const base = MarcBase.fromBuffer(createMultiRecordBuffer(3));
      const bytes = base.getSerializedRecord(1);
      const reloaded = MarcBase.fromBuffer(bytes);
      expect(reloaded.totalRecords).toBe(1);
      expect(reloaded.getRecord(0).leader).toBe(base.getRecord(1).leader);
    });
  });

  describe('iterateSerializedRecords', () => {
    it('yields one Uint8Array per record', () => {
      const base = MarcBase.fromBuffer(createMultiRecordBuffer(4));
      const chunks = Array.from(base.iterateSerializedRecords());
      expect(chunks).toHaveLength(4);
      chunks.forEach((c) => expect(c).toBeInstanceOf(Uint8Array));
    });

    it('yields zero chunks for empty buffer', () => {
      const base = MarcBase.fromBuffer(new Uint8Array(0));
      expect(Array.from(base.iterateSerializedRecords())).toHaveLength(0);
    });

    it('yields zero-copy views (same backing buffer)', () => {
      const buffer = createMultiRecordBuffer(3);
      const base = MarcBase.fromBuffer(buffer);
      for (const chunk of base.iterateSerializedRecords()) {
        expect(chunk.buffer).toBe(buffer.buffer);
      }
    });

    it('chunks concatenate to reproduce the original buffer', () => {
      const buffer = createMultiRecordBuffer(3);
      const base = MarcBase.fromBuffer(buffer);
      const chunks = Array.from(base.iterateSerializedRecords());
      const total = chunks.reduce((s, c) => s + c.length, 0);
      expect(total).toBe(buffer.length);
      const rebuilt = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        rebuilt.set(c, off);
        off += c.length;
      }
      expect(Array.from(rebuilt)).toEqual(Array.from(buffer));
    });
  });

  describe('evictFromCache', () => {
    it('causes the next getRecord call to re-parse', () => {
      const base = MarcBase.fromBuffer(createMultiRecordBuffer(3));
      const first = base.getRecord(0);
      base.evictFromCache(0);
      const second = base.getRecord(0);
      // Different object after eviction (re-parsed)
      expect(second).not.toBe(first);
    });

    it('does not throw for an index not in cache', () => {
      const base = MarcBase.fromBuffer(createMultiRecordBuffer(3));
      expect(() => base.evictFromCache(0)).not.toThrow();
    });

    it('does not affect other cached records', () => {
      const base = MarcBase.fromBuffer(createMultiRecordBuffer(3));
      const r1 = base.getRecord(1);
      base.getRecord(0);
      base.evictFromCache(0);
      expect(base.getRecord(1)).toBe(r1);
    });
  });
});

describe('copyBuffer option', () => {
  it('shares the caller buffer by default', () => {
    const buffer = createMultiRecordBuffer(2);
    const base = MarcBase.fromBuffer(buffer);
    expect(base.getSerializedRecordView(0).buffer).toBe(buffer.buffer);
  });

  it('isolates the store from later writes to the caller buffer', () => {
    const buffer = createMultiRecordBuffer(2);
    const original = buffer.slice();
    const base = MarcBase.fromBuffer(buffer, { copyBuffer: true });
    buffer.fill(0xff);
    expect(base.getSerializedRecordView(0).buffer).not.toBe(buffer.buffer);
    expect(Array.from(base.iterateSerializedRecords()).flatMap((c) => Array.from(c))).toEqual(
      Array.from(original)
    );
  });

  it('copies only the viewed bytes of a Uint8Array subarray', () => {
    const records = createMultiRecordBuffer(3);
    const padded = new Uint8Array(records.length + 10);
    padded.set(records, 10);
    const sub = padded.subarray(10);
    const base = new MarcBase(sub, indexBuffer(sub), 200, { copyBuffer: true });
    const view = base.getSerializedRecordView(1);
    expect(view.buffer).not.toBe(padded.buffer);
    expect(view.buffer.byteLength).toBe(records.length);
    expect(base.getRecord(2).fields[0]).toMatchObject({ tag: '001' });
  });

  it('is accepted by MarcFile.fromBuffer', () => {
    const buffer = createMultiRecordBuffer(2);
    const store = MarcFile.fromBuffer(buffer, { copyBuffer: true });
    buffer.fill(0xff);
    expect(store.getRecord(1).fields[0]).toMatchObject({ tag: '001' });
  });
});
