import { describe, it, expect } from 'vitest';
import { MarcFile } from '../record-store.js';
import { applyToAll, applyToMatching, deleteMatching, keepMatching, toMarcBinary, toMarcXml, toJson } from '../transform.js';
import { createTypicalRecord, createMultiRecordBuffer, serializeRecord } from './helpers/test-data.js';
import { appendField, getField, isDataField } from 'marc-ts';

describe('applyToAll', () => {
  it('applies fn to every record and returns count', () => {
    const store = MarcFile.fromBuffer(createMultiRecordBuffer(5));
    const note = { tag: '500', indicator1: ' ', indicator2: ' ', subfields: [{ code: 'a', value: 'Added' }] };
    const count = applyToAll(store, r => appendField(r, note));
    expect(count).toBe(5);
    expect(store.modifiedCount).toBe(5);
    for (let i = 0; i < 5; i++) {
      expect(store.getRecord(i).fields.some(f => isDataField(f) && f.tag === '500')).toBe(true);
    }
  });

  it('returns 0 for empty store', () => {
    const store = MarcFile.fromBuffer(new Uint8Array(0));
    expect(applyToAll(store, r => r)).toBe(0);
  });
});

describe('applyToMatching', () => {
  it('applies fn only to matching records', () => {
    const store = MarcFile.fromBuffer(createMultiRecordBuffer(5));
    const note = { tag: '500', indicator1: ' ', indicator2: ' ', subfields: [{ code: 'a', value: 'Matched' }] };
    // Match records whose 001 field data ends in an even digit
    const count = applyToMatching(
      store,
      r => {
        const f = getField(r, '001');
        return f !== undefined && !isDataField(f) && Number(f.data) % 2 === 0;
      },
      r => appendField(r, note),
    );
    // Records 0, 2, 4 match (ids 00000000, 00000002, 00000004)
    expect(count).toBe(3);
    expect(store.modifiedCount).toBe(3);
  });

  it('returns 0 and leaves store unchanged when no records match', () => {
    const store = MarcFile.fromBuffer(createMultiRecordBuffer(4));
    const count = applyToMatching(store, () => false, r => r);
    expect(count).toBe(0);
    expect(store.modifiedCount).toBe(0);
  });

  it('behaves like applyToAll when predicate always returns true', () => {
    const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
    const count = applyToMatching(store, () => true, r => r);
    expect(count).toBe(3);
  });
});

describe('deleteMatching', () => {
  it('deletes records matching the predicate', () => {
    const store = MarcFile.fromBuffer(createMultiRecordBuffer(5));
    // Delete records with 001 value >= 3 (ids 00000003, 00000004)
    const deleted = deleteMatching(store, r => {
      const f = getField(r, '001');
      return f !== undefined && !isDataField(f) && Number(f.data) >= 3;
    });
    expect(deleted).toBe(2);
    expect(store.totalRecords).toBe(3);
  });

  it('deletes all records when predicate always returns true', () => {
    const store = MarcFile.fromBuffer(createMultiRecordBuffer(4));
    const deleted = deleteMatching(store, () => true);
    expect(deleted).toBe(4);
    expect(store.totalRecords).toBe(0);
  });

  it('deletes nothing when predicate always returns false', () => {
    const store = MarcFile.fromBuffer(createMultiRecordBuffer(4));
    const deleted = deleteMatching(store, () => false);
    expect(deleted).toBe(0);
    expect(store.totalRecords).toBe(4);
  });

  it('leaves correct records after non-contiguous deletions', () => {
    const store = MarcFile.fromBuffer(createMultiRecordBuffer(5));
    // Delete odd-id records (00000001, 00000003)
    deleteMatching(store, r => {
      const f = getField(r, '001');
      return f !== undefined && !isDataField(f) && Number(f.data) % 2 !== 0;
    });
    expect(store.totalRecords).toBe(3);
    for (let i = 0; i < store.totalRecords; i++) {
      const f = getField(store.getRecord(i), '001');
      expect(f).toBeDefined();
      if (f && !isDataField(f)) {
        expect(Number(f.data) % 2).toBe(0);
      }
    }
  });
});

describe('keepMatching', () => {
  it('keeps only records matching the predicate', () => {
    const store = MarcFile.fromBuffer(createMultiRecordBuffer(5));
    // Keep only records with 001 value < 3
    const deleted = keepMatching(store, r => {
      const f = getField(r, '001');
      return f !== undefined && !isDataField(f) && Number(f.data) < 3;
    });
    expect(deleted).toBe(2);
    expect(store.totalRecords).toBe(3);
  });

  it('deletes all records when predicate always returns false', () => {
    const store = MarcFile.fromBuffer(createMultiRecordBuffer(4));
    const deleted = keepMatching(store, () => false);
    expect(deleted).toBe(4);
    expect(store.totalRecords).toBe(0);
  });

  it('keeps all records when predicate always returns true', () => {
    const store = MarcFile.fromBuffer(createMultiRecordBuffer(4));
    const deleted = keepMatching(store, () => true);
    expect(deleted).toBe(0);
    expect(store.totalRecords).toBe(4);
  });
});

describe('toMarcBinary', () => {
  it('produces a buffer that round-trips correctly', () => {
    const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
    const binary = toMarcBinary(store);
    expect(binary).toBeInstanceOf(Uint8Array);
    const reloaded = MarcFile.fromBuffer(binary);
    expect(reloaded.totalRecords).toBe(3);
    expect(reloaded.getRecord(0).leader).toBe(store.getRecord(0).leader);
  });

  it('returns empty Uint8Array for empty store', () => {
    const store = MarcFile.fromBuffer(new Uint8Array(0));
    expect(toMarcBinary(store).length).toBe(0);
  });

  it('preserves overlay modifications in output', () => {
    const store = MarcFile.fromBuffer(createMultiRecordBuffer(2));
    const note = { tag: '500', indicator1: ' ', indicator2: ' ', subfields: [{ code: 'a', value: 'Preserved' }] };
    store.setRecord(0, appendField(store.getRecord(0), note));
    const reloaded = MarcFile.fromBuffer(toMarcBinary(store));
    expect(reloaded.getRecord(0).fields.some(f => isDataField(f) && f.tag === '500')).toBe(true);
  });
});

describe('toMarcXml', () => {
  it('produces well-formed MARCXML with expected structure', () => {
    const store = MarcFile.fromBuffer(createMultiRecordBuffer(2));
    const xml = toMarcXml(store);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('xmlns="http://www.loc.gov/MARC21/slim"');
    expect(xml).toContain('<record>');
    expect(xml).toContain('<leader>');
    expect(xml).toContain('<controlfield tag="001">');
    expect(xml).toContain('<datafield tag="245"');
    expect(xml).toContain('<subfield code="a">');
  });

  it('respects custom encoding option', () => {
    const store = MarcFile.fromBuffer(createMultiRecordBuffer(1));
    const xml = toMarcXml(store, { encoding: 'ISO-8859-1' });
    expect(xml).toContain('encoding="ISO-8859-1"');
  });

  it('produces valid XML for empty store', () => {
    const store = MarcFile.fromBuffer(new Uint8Array(0));
    const xml = toMarcXml(store);
    expect(xml).toContain('<collection');
    expect(xml).toContain('</collection>');
    expect(xml).not.toContain('<record>');
  });

  it('escapes special characters in field data', () => {
    const record = createTypicalRecord('1');
    const withSpecialChars = appendField(record, {
      tag: '500',
      indicator1: ' ',
      indicator2: ' ',
      subfields: [{ code: 'a', value: `A & B <c> "d" 'e'` }],
    });
    const store = MarcFile.fromBuffer(serializeRecord(withSpecialChars));
    const xml = toMarcXml(store);
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&lt;');
    expect(xml).toContain('&gt;');
    expect(xml).toContain('&quot;');
    expect(xml).toContain('&apos;');
    expect(xml).not.toContain(' & ');
  });
});

describe('toJson', () => {
  it('produces a JSON array with correct record shape', () => {
    const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
    const parsed = JSON.parse(toJson(store)) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(3);
    const first = parsed[0] as Record<string, unknown>;
    expect(typeof first['leader']).toBe('string');
    expect(Array.isArray(first['fields'])).toBe(true);
  });

  it('serializes control fields as { tag, data }', () => {
    const store = MarcFile.fromBuffer(createMultiRecordBuffer(1));
    const parsed = JSON.parse(toJson(store)) as Array<{ fields: Array<Record<string, unknown>> }>;
    const controlField = parsed[0].fields.find(f => f['tag'] === '001');
    expect(controlField).toBeDefined();
    expect(typeof controlField!['data']).toBe('string');
    expect(controlField!['subfields']).toBeUndefined();
  });

  it('serializes data fields as { tag, indicator1, indicator2, subfields }', () => {
    const store = MarcFile.fromBuffer(createMultiRecordBuffer(1));
    const parsed = JSON.parse(toJson(store)) as Array<{ fields: Array<Record<string, unknown>> }>;
    const dataField = parsed[0].fields.find(f => f['tag'] === '245');
    expect(dataField).toBeDefined();
    expect(typeof dataField!['indicator1']).toBe('string');
    expect(typeof dataField!['indicator2']).toBe('string');
    expect(Array.isArray(dataField!['subfields'])).toBe(true);
  });

  it('pretty option produces indented output', () => {
    const store = MarcFile.fromBuffer(createMultiRecordBuffer(1));
    const compact = toJson(store);
    const pretty = toJson(store, { pretty: true });
    expect(pretty).toContain('\n');
    expect(pretty.length).toBeGreaterThan(compact.length);
  });

  it('returns empty array for empty store', () => {
    const store = MarcFile.fromBuffer(new Uint8Array(0));
    expect(JSON.parse(toJson(store))).toEqual([]);
  });
});
