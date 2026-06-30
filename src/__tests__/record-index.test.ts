import { describe, it, expect, vi } from 'vitest';
import { indexBuffer } from '../record-index.js';
import {
  createMinimalRecord,
  createTypicalRecord,
  createMultiRecordBuffer,
  serializeRecord,
} from './helpers/test-data.js';

describe('indexBuffer', () => {
  it('indexes a single valid record', () => {
    const record = createMinimalRecord('12345678');
    const buffer = serializeRecord(record);

    const index = indexBuffer(buffer);

    expect(index).toHaveLength(1);
    expect(index[0].offset).toBe(0);
    expect(index[0].length).toBe(buffer.length);
  });

  it('indexes multiple consecutive records', () => {
    const buffer = createMultiRecordBuffer(10);
    const index = indexBuffer(buffer);

    expect(index).toHaveLength(10);
    expect(index[0].offset).toBe(0);

    // Verify each record starts where the previous one ends
    for (let i = 1; i < index.length; i++) {
      const prevEnd = index[i - 1].offset + index[i - 1].length;
      expect(index[i].offset).toBe(prevEnd);
    }

    // Verify total coverage
    const lastRecord = index[index.length - 1];
    const totalCovered = lastRecord.offset + lastRecord.length;
    expect(totalCovered).toBe(buffer.length);
  });

  it('handles empty buffer (returns empty array)', () => {
    const buffer = new Uint8Array(0);
    const index = indexBuffer(buffer);

    expect(index).toHaveLength(0);
  });

  it('stops at truncated length field', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const record = createTypicalRecord('12345678');
    const fullBuffer = serializeRecord(record);

    // Truncate to only 3 bytes (need 5 for length field)
    const truncatedBuffer = fullBuffer.slice(0, 3);

    const index = indexBuffer(truncatedBuffer);

    expect(index).toHaveLength(0); // No complete records
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Truncated length field'));

    consoleWarnSpy.mockRestore();
  });

  it('stops at invalid (non-numeric) length', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Create buffer with invalid length field
    const buffer = new Uint8Array(24);
    const encoder = new TextEncoder();
    encoder.encodeInto('XXXXX', buffer); // Invalid length (not numeric)

    const index = indexBuffer(buffer);

    expect(index).toHaveLength(0);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid (non-numeric) length')
    );

    consoleWarnSpy.mockRestore();
  });

  it('stops at partial-number length field (e.g. "1234X")', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const buffer = new Uint8Array(24);
    const encoder = new TextEncoder();
    encoder.encodeInto('1234X', buffer); // parseInt would return 1234, but must be rejected

    const index = indexBuffer(buffer);

    expect(index).toHaveLength(0);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid (non-numeric) length')
    );

    consoleWarnSpy.mockRestore();
  });

  it('stops when record would overflow buffer', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const record1 = createTypicalRecord('00000001');
    const record2 = createTypicalRecord('00000002');

    const buffer1 = serializeRecord(record1);
    const buffer2 = serializeRecord(record2);

    // Concatenate two records but truncate the second one
    const fullBuffer = new Uint8Array(buffer1.length + buffer2.length);
    fullBuffer.set(buffer1, 0);
    fullBuffer.set(buffer2, buffer1.length);

    // Truncate so second record is incomplete
    const truncatedBuffer = fullBuffer.slice(0, buffer1.length + 10);

    const index = indexBuffer(truncatedBuffer);

    // Should only index the first record
    expect(index).toHaveLength(1);
    expect(index[0].length).toBe(buffer1.length);
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('would overflow buffer'));

    consoleWarnSpy.mockRestore();
  });

  it('handles minimum-size records (24 bytes)', () => {
    // Create a record with minimal content
    const minimalRecord = createMinimalRecord('1');
    const buffer = serializeRecord(minimalRecord);

    // Verify it's at least 24 bytes (MARC minimum)
    expect(buffer.length).toBeGreaterThanOrEqual(24);

    const index = indexBuffer(buffer);

    expect(index).toHaveLength(1);
    expect(index[0].offset).toBe(0);
    expect(index[0].length).toBe(buffer.length);
    expect(index[0].length).toBeGreaterThanOrEqual(24);
  });

  it('stops at record with length < 24', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Create buffer with invalid short length
    const buffer = new Uint8Array(24);
    const encoder = new TextEncoder();
    encoder.encodeInto('00010', buffer); // Length of 10 (< 24 minimum)

    const index = indexBuffer(buffer);

    expect(index).toHaveLength(0);
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('< 24 bytes'));

    consoleWarnSpy.mockRestore();
  });

  it('indexes large number of records efficiently', () => {
    const recordCount = 1000;
    const buffer = createMultiRecordBuffer(recordCount);

    const startTime = performance.now();
    const index = indexBuffer(buffer);
    const duration = performance.now() - startTime;

    expect(index).toHaveLength(recordCount);

    // Should be fast (< 100ms for 1000 records)
    // Relaxed target since we're testing indexing speed, not parsing
    expect(duration).toBeLessThan(100);
  });

  it('handles records of varying sizes', () => {
    const records = [
      createMinimalRecord('1'),
      createTypicalRecord('2'),
      createMinimalRecord('3'),
      createTypicalRecord('4'),
    ];

    const buffers = records.map(serializeRecord);
    const totalLength = buffers.reduce((sum, buf) => sum + buf.length, 0);

    const combinedBuffer = new Uint8Array(totalLength);
    let offset = 0;
    for (const buf of buffers) {
      combinedBuffer.set(buf, offset);
      offset += buf.length;
    }

    const index = indexBuffer(combinedBuffer);

    expect(index).toHaveLength(4);

    // Verify lengths match original buffers
    for (let i = 0; i < index.length; i++) {
      expect(index[i].length).toBe(buffers[i].length);
    }
  });
});
