import { describe, it, expect, vi } from 'vitest';
import { scanBuffer, indexBuffer } from '../record-index.js';
import { MarcFile } from '../marc-file.js';
import { MarcBase } from '../marc-base.js';
import { toMarcBinary } from '../transform.js';
import {
  createMultiRecordBuffer,
  createTypicalRecord,
  serializeRecord,
} from './helpers/test-data.js';

function concat(...parts: (Uint8Array | number[] | string)[]): Uint8Array {
  const arrays = parts.map((p) =>
    typeof p === 'string'
      ? new TextEncoder().encode(p)
      : p instanceof Uint8Array
        ? p
        : new Uint8Array(p)
  );
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

const rec = (id: string) => serializeRecord(createTypicalRecord(id));

describe('scanBuffer', () => {
  it('returns no issues for a clean file', () => {
    const buffer = createMultiRecordBuffer(3);
    const result = scanBuffer(buffer);
    expect(result.index).toHaveLength(3);
    expect(result.issues).toEqual([]);
    expect(result.bytesConsumed).toBe(buffer.length);
  });

  it('skips newlines and other whitespace between records', () => {
    const a = rec('1');
    const b = rec('2');
    const buffer = concat(a, '\r\n', b, '\n\n');
    const result = scanBuffer(buffer);
    expect(result.index).toEqual([
      { offset: 0, length: a.length },
      { offset: a.length + 2, length: b.length },
    ]);
    expect(result.issues).toEqual([]);
    expect(result.bytesConsumed).toBe(buffer.length);
  });

  it('reports a record without the 0x1D terminator but still indexes it', () => {
    const a = rec('1');
    a[a.length - 1] = 0x41;
    const result = scanBuffer(a);
    expect(result.index).toHaveLength(1);
    expect(result.issues.map((i) => i.kind)).toEqual(['missing-terminator']);
  });

  it('does not let a record missing its terminator swallow the next record', () => {
    const a = rec('1');
    const b = rec('2');
    a[a.length - 1] = 0x41;
    const result = scanBuffer(concat(a, b));
    expect(result.index).toEqual([
      { offset: 0, length: a.length },
      { offset: a.length, length: b.length },
    ]);
    expect(result.issues.map((i) => i.kind)).toEqual(['missing-terminator']);
  });

  it('skips junk ending in a terminator that is too short to be a record', () => {
    const a = rec('1');
    const b = rec('2');
    const junk = concat('XXXXX garbage', [0x1d]);
    const buffer = concat(a, junk, b);
    const result = scanBuffer(buffer);
    expect(result.index).toEqual([
      { offset: 0, length: a.length },
      { offset: a.length + junk.length, length: b.length },
    ]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      kind: 'skipped',
      offset: a.length,
      length: junk.length,
    });
    expect(result.bytesConsumed).toBe(buffer.length);
  });

  it('stops with the original problem when no terminator follows', () => {
    const a = rec('1');
    const buffer = concat(a, '99999 no terminator here');
    const result = scanBuffer(buffer);
    expect(result.index).toHaveLength(1);
    expect(result.issues.map((i) => i.kind)).toEqual(['overflow']);
    expect(result.issues[0]!.message).toContain('Stopping');
    expect(result.bytesConsumed).toBe(a.length);
  });

  it('calls onIssue for each issue and never logs', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onIssue = vi.fn();
    scanBuffer(concat(rec('1'), 'abc'), { onIssue });
    expect(onIssue).toHaveBeenCalledTimes(1);
    expect(onIssue.mock.calls[0]![0]).toMatchObject({ kind: 'truncated-length' });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('indexBuffer options', () => {
  it('routes issues to onIssue instead of console.warn when given', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onIssue = vi.fn();
    indexBuffer(concat(rec('1'), 'abc'), { onIssue });
    expect(onIssue).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('fromBuffer index issues', () => {
  it('exposes indexIssues so a partial index can be detected', () => {
    const onIssue = vi.fn();
    const store = MarcFile.fromBuffer(concat(rec('1'), '99999 no terminator'), { onIssue });
    expect(store.totalRecords).toBe(1);
    expect(store.indexIssues.map((i) => i.kind)).toEqual(['overflow']);
    expect(onIssue).toHaveBeenCalledTimes(1);
  });

  it('indexes newline-separated files completely', () => {
    const store = MarcFile.fromBuffer(concat(rec('1'), '\n', rec('2'), '\n'));
    expect(store.totalRecords).toBe(2);
    expect(store.indexIssues).toEqual([]);
  });

  it('still accepts a cache capacity number', () => {
    const store = MarcFile.fromBuffer(createMultiRecordBuffer(2), 10);
    expect(store.totalRecords).toBe(2);
    expect(store.indexIssues).toEqual([]);
  });

  it('has no issues when constructed with an explicit index', () => {
    const buffer = createMultiRecordBuffer(2);
    expect(new MarcFile(buffer, indexBuffer(buffer)).indexIssues).toEqual([]);
  });

  it('is also available on MarcBase.fromBuffer', () => {
    const base = MarcBase.fromBuffer(concat(rec('1'), 'abc'), { onIssue: () => {} });
    expect(base.totalRecords).toBe(1);
    expect(base.indexIssues.map((i) => i.kind)).toEqual(['truncated-length']);
  });
});

describe('wrong leader length', () => {
  const clean = [rec('1'), rec('2'), rec('3')];
  const cleanFile = concat(...clean);

  /** The three clean records, with the middle record's 5-byte length field overwritten. */
  function withMiddleLength(declared: string): Uint8Array {
    const buffer = cleanFile.slice();
    buffer.set(new TextEncoder().encode(declared), clean[0]!.length);
    return buffer;
  }

  const L = clean[1]!.length;
  const pad = (n: number) => String(n).padStart(5, '0');
  const scenarios: [string, string][] = [
    ['too long', pad(L + 10)],
    ['too short', pad(L - 10)],
    ['past the end of the file', '99999'],
    ['below the 24-byte minimum', '00012'],
    ['exactly two records long', pad(L + clean[2]!.length)],
    ['non-numeric', 'abcde'],
  ];

  it.each(scenarios)('indexes, parses and repairs a record whose length is %s', (_, declared) => {
    const store = MarcFile.fromBuffer(withMiddleLength(declared), { onIssue: () => {} });

    expect(store.totalRecords).toBe(3);
    expect([0, 1, 2].map((i) => store.getRecord(i).fields[0])).toEqual([
      { tag: '001', data: '1' },
      { tag: '001', data: '2' },
      { tag: '001', data: '3' },
    ]);

    expect(store.indexIssues).toHaveLength(1);
    expect(store.indexIssues[0]).toMatchObject({
      kind: 'length-mismatch',
      offset: clean[0]!.length,
      declaredLength: declared,
      length: L,
    });

    const output = toMarcBinary(store);
    expect(output).toEqual(cleanFile);
    expect(scanBuffer(output).issues).toEqual([]);
  });

  it('getSerializedRecord returns the record with its leader length corrected', () => {
    const store = MarcFile.fromBuffer(withMiddleLength(pad(L + 10)), { onIssue: () => {} });
    expect(store.getSerializedRecord(1)).toEqual(clean[1]);
  });
});
