import { describe, it, expect } from 'vitest';
import { serializeMarcBinary } from 'marc-ts';
import type { MarcRecord } from 'marc-ts';
import { serializeMarcJson } from 'marc-ts/json';
import { MarcFile } from '../record-store.js';
import { iterateMarcXml, toMarcXml, iterateJson, toJson } from '../export.js';
import { indexBuffer } from '../record-index.js';
import { createMultiRecordBuffer, createTypicalRecord } from './helpers/test-data.js';

function marc8Record(id: string, title: string): MarcRecord {
  return {
    leader: '00000nam  2200000   4500',
    fields: [
      { tag: '001', data: id },
      { tag: '245', indicator1: '1', indicator2: '0', subfields: [{ code: 'a', value: title }] },
    ],
  };
}

/** A UTF-8 record followed by a MARC-8 one containing non-ASCII text. */
function mixedStore(): MarcFile {
  const utf8 = serializeMarcBinary([createTypicalRecord('u1')]);
  const marc8 = serializeMarcBinary([marc8Record('m8', 'Café résumé')], { encoding: 'marc8' });
  const buffer = new Uint8Array(utf8.length + marc8.length);
  buffer.set(utf8, 0);
  buffer.set(marc8, utf8.length);
  return MarcFile.fromBuffer(buffer);
}

/** Three records; the one at position 1 has a valid length but fails to parse. */
function storeWithCorruptMiddle(): MarcFile {
  const buffer = createMultiRecordBuffer(3);
  const { offset } = indexBuffer(buffer)[1]!;
  for (let i = offset + 24; i < offset + 50; i++) buffer[i] = 0xff;
  return MarcFile.fromBuffer(buffer);
}

describe('iterateMarcXml', () => {
  it('yields an opening chunk, one chunk per record and a closing chunk', () => {
    const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
    const chunks = Array.from(iterateMarcXml(store));
    expect(chunks).toHaveLength(5);
    expect(chunks[0]).toContain('<collection');
    expect(chunks.slice(1, 4).every((c) => c.includes('<record>') && c.includes('</record>'))).toBe(
      true
    );
    expect(chunks[4]).toBe('\n</collection>');
    expect(chunks.join('')).toBe(toMarcXml(store));
  });

  it('produces the same layout as before (newline-separated lines)', () => {
    const xml = toMarcXml(MarcFile.fromBuffer(createMultiRecordBuffer(1)));
    expect(xml.split('\n').slice(0, 4)).toEqual([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<collection xmlns="http://www.loc.gov/MARC21/slim">',
      '  <record>',
      expect.stringMatching(/^ {4}<leader>.{24}<\/leader>$/),
    ]);
    expect(xml.endsWith('  </record>\n</collection>')).toBe(true);
  });

  it('writes MARC-8 source records as Unicode with leader/09 = a', () => {
    // MARC-8 stores accents as combining characters, so the decoded text is NFD.
    const xml = toMarcXml(mixedStore());
    expect(xml.normalize('NFC')).toContain('Café résumé');
    const leaders = [...xml.matchAll(/<leader>(.{24})<\/leader>/g)].map((m) => m[1]!);
    expect(leaders.map((l) => l[9])).toEqual(['a', 'a']);
  });

  it('supports onError', () => {
    const chunks = Array.from(iterateMarcXml(storeWithCorruptMiddle(), { onError: 'skip' }));
    expect(chunks).toHaveLength(4);
  });
});

describe('iterateJson / toJson', () => {
  it('defaults to MARC-in-JSON, matching marc-ts serializeMarcJson', () => {
    const store = MarcFile.fromBuffer(createMultiRecordBuffer(2));
    const parsed = JSON.parse(toJson(store));
    const expected = JSON.parse(
      JSON.stringify(serializeMarcJson(Array.from(store.iterateRecords(), (r) => r.record)))
    );
    expect(parsed).toEqual(expected);
    expect(parsed[0].fields[0]).toEqual({ '001': '00000000' });
    expect(parsed[0].fields.find((f: object) => '245' in f)['245']).toMatchObject({
      ind1: '1',
      ind2: '0',
      subfields: [{ a: 'Test Title 00000000' }, { c: 'Test Author' }],
    });
  });

  it("keeps the old shape with format: 'simple'", () => {
    const store = MarcFile.fromBuffer(createMultiRecordBuffer(1));
    const [record] = JSON.parse(toJson(store, { format: 'simple' }));
    expect(record.fields[0]).toEqual({ tag: '001', data: '00000000' });
    expect(record.fields[2]).toMatchObject({ tag: '245', indicator1: '1', indicator2: '0' });
  });

  it.each(['marc-in-json', 'simple'] as const)(
    'pretty output matches JSON.stringify(array, null, 2) (%s)',
    (format) => {
      const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
      const compact = toJson(store, { format });
      expect(toJson(store, { format, pretty: true })).toBe(
        JSON.stringify(JSON.parse(compact), null, 2)
      );
    }
  );

  it('streams one chunk per record and joins to toJson', () => {
    const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
    for (const pretty of [false, true]) {
      const chunks = Array.from(iterateJson(store, { pretty }));
      expect(chunks).toHaveLength(4);
      expect(chunks.join('')).toBe(toJson(store, { pretty }));
    }
  });

  it('writes NDJSON with one parseable record per line', () => {
    const store = MarcFile.fromBuffer(createMultiRecordBuffer(3));
    const ndjson = toJson(store, { ndjson: true, pretty: true });
    const lines = ndjson.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[3]).toBe('');
    expect(lines.slice(0, 3).map((l) => JSON.parse(l))).toEqual(JSON.parse(toJson(store)));
  });

  it('handles an empty store', () => {
    const empty = MarcFile.fromBuffer(new Uint8Array(0));
    expect(toJson(empty)).toBe('[]');
    expect(toJson(empty, { pretty: true })).toBe('[]');
    expect(toJson(empty, { ndjson: true })).toBe('');
  });

  it.each(['marc-in-json', 'simple'] as const)(
    'writes MARC-8 source records as Unicode with leader/09 = a (%s)',
    (format) => {
      const [, record] = JSON.parse(toJson(mixedStore(), { format }));
      expect(record.leader[9]).toBe('a');
      expect(JSON.stringify(record).normalize('NFC')).toContain('Café résumé');
    }
  );
});
