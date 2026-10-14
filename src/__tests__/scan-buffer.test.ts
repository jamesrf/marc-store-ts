import { describe, it, expect, vi } from 'vitest';
import { scanBuffer, indexBuffer } from '../record-index.js';
import { MarcFile } from '../record-store.js';
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

  it('stops at an invalid record by default and reports where', () => {
    const a = rec('1');
    const buffer = concat(a, 'XXXXX garbage', [0x1d], rec('2'));
    const result = scanBuffer(buffer);
    expect(result.index).toHaveLength(1);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ kind: 'invalid-length', offset: a.length });
    expect(result.bytesConsumed).toBe(a.length);
  });

  it('resynchronises on the next record terminator in recover mode', () => {
    const a = rec('1');
    const b = rec('2');
    const garbage = concat('XXXXX garbage', [0x1d]);
    const buffer = concat(a, garbage, b);
    const result = scanBuffer(buffer, { recover: true });
    expect(result.index).toEqual([
      { offset: 0, length: a.length },
      { offset: a.length + garbage.length, length: b.length },
    ]);
    expect(result.issues.map((i) => i.kind)).toEqual(['invalid-length', 'skipped']);
    expect(result.bytesConsumed).toBe(buffer.length);
  });

  it('consumes the rest of the buffer in recover mode when no terminator follows', () => {
    const a = rec('1');
    const buffer = concat(a, '99999 no terminator here');
    const result = scanBuffer(buffer, { recover: true });
    expect(result.index).toHaveLength(1);
    expect(result.issues.map((i) => i.kind)).toEqual(['overflow', 'skipped']);
    expect(result.bytesConsumed).toBe(buffer.length);
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
    const store = MarcFile.fromBuffer(concat(rec('1'), 'XXXXX', [0x1d], rec('2')), { onIssue });
    expect(store.totalRecords).toBe(1);
    expect(store.indexIssues.map((i) => i.kind)).toEqual(['invalid-length']);
    expect(onIssue).toHaveBeenCalledTimes(1);
  });

  it('recovers records after a corrupt one when asked', () => {
    const buffer = concat(rec('1'), 'XXXXX', [0x1d], rec('2'));
    const store = MarcFile.fromBuffer(buffer, { recover: true, onIssue: () => {} });
    expect(store.totalRecords).toBe(2);
    expect(store.getRecord(1).fields[0]).toMatchObject({ tag: '001', data: '2' });
    expect(toMarcBinary(store)).toEqual(concat(rec('1'), rec('2')));
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
