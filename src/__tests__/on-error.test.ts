import { describe, it, expect, vi } from 'vitest';
import { appendField } from 'marc-ts';
import type { MarcRecord } from 'marc-ts';
import { MarcFile } from '../record-store.js';
import { iterateRecordResults } from '../iterate.js';
import {
  applyToAll,
  applyToMatching,
  deleteMatching,
  keepMatching,
  toMarcBinary,
  toMarcXml,
  toJson,
} from '../transform.js';
import { SearchIndex } from '../search-index.js';
import { indexBuffer } from '../record-index.js';
import { createMultiRecordBuffer } from './helpers/test-data.js';

/** Three records; the one at position 1 has a valid length but fails to parse. */
function storeWithCorruptMiddle(): MarcFile {
  const buffer = createMultiRecordBuffer(3);
  const index = indexBuffer(buffer);
  const { offset } = index[1]!;
  for (let i = offset + 24; i < offset + 50; i++) buffer[i] = 0xff;
  return new MarcFile(buffer, index);
}

const note = (r: MarcRecord) =>
  appendField(r, {
    tag: '500',
    indicator1: ' ',
    indicator2: ' ',
    subfields: [{ code: 'a', value: 'n' }],
  });

describe('iterateRecordResults', () => {
  it('yields a result per position, including failures, without throwing', () => {
    const results = [...iterateRecordResults(storeWithCorruptMiddle())];
    expect(results.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(results.map((r) => r.result.ok)).toEqual([true, false, true]);
    const failed = results[1]!.result;
    expect(!failed.ok && failed.error).toContain('Parse failed at index 1');
  });
});

describe('onError option', () => {
  it('throws by default, as before', () => {
    expect(() => applyToAll(storeWithCorruptMiddle(), note)).toThrow(/Parse failed/);
    expect(() => toMarcXml(storeWithCorruptMiddle())).toThrow(/Parse failed/);
    expect(() => toJson(storeWithCorruptMiddle())).toThrow(/Parse failed/);
    expect(() => new SearchIndex().build(storeWithCorruptMiddle())).toThrow(/Parse failed/);
  });

  it("'skip' leaves corrupt records untouched in applyToAll", () => {
    const store = storeWithCorruptMiddle();
    expect(applyToAll(store, note, { onError: 'skip' })).toBe(2);
    expect(store.isModified(0)).toBe(true);
    expect(store.isModified(1)).toBe(false);
    expect(store.isModified(2)).toBe(true);
  });

  it('calls an onError callback with the position and message', () => {
    const onError = vi.fn();
    const store = storeWithCorruptMiddle();
    expect(applyToMatching(store, () => true, note, { onError })).toBe(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(1, expect.stringContaining('Parse failed'));
  });

  it('keeps corrupt records in deleteMatching and keepMatching', () => {
    const a = storeWithCorruptMiddle();
    expect(deleteMatching(a, () => true, { onError: 'skip' })).toBe(2);
    expect(a.totalRecords).toBe(1);
    expect(a.tryGetRecord(0).ok).toBe(false);

    const b = storeWithCorruptMiddle();
    expect(keepMatching(b, () => false, { onError: 'skip' })).toBe(2);
    expect(b.totalRecords).toBe(1);
  });

  it('omits corrupt records from toMarcXml and toJson when skipping', () => {
    const xml = toMarcXml(storeWithCorruptMiddle(), { onError: 'skip' });
    expect(xml.match(/<record>/g)).toHaveLength(2);
    const json = JSON.parse(toJson(storeWithCorruptMiddle(), { onError: 'skip' }));
    expect(json).toHaveLength(2);
  });

  it('builds a search index over the readable records when skipping', () => {
    const index = new SearchIndex();
    index.build(storeWithCorruptMiddle(), { onError: 'skip' });
    expect(index.size).toBe(2);
    expect(
      index
        .search('Test Title')
        .map((r) => r.position)
        .sort()
    ).toEqual([0, 2]);
  });

  it('toMarcBinary writes corrupt records unchanged since it does not parse', () => {
    const output = toMarcBinary(storeWithCorruptMiddle());
    expect(output).toHaveLength(createMultiRecordBuffer(3).length);
  });
});
