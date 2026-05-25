import { serializeMarcRecord, type MarcRecord } from 'marc-ts';

/**
 * Create a minimal valid MARC record with just control field 001.
 *
 * @param id - Control number (001 field value)
 * @returns Minimal MarcRecord
 */
export function createMinimalRecord(id: string): MarcRecord {
  return {
    leader: '00000nam  2200000   4500',
    fields: [{ tag: '001', data: id }],
  };
}

/**
 * Create a typical MARC record with common fields.
 *
 * @param id - Control number (001 field value)
 * @returns MarcRecord with 001, 003, and 245 fields
 */
export function createTypicalRecord(id: string): MarcRecord {
  return {
    leader: '00000nam  2200000   4500',
    fields: [
      { tag: '001', data: id },
      { tag: '003', data: 'TEST' },
      {
        tag: '245',
        indicator1: '1',
        indicator2: '0',
        subfields: [
          { code: 'a', value: `Test Title ${id}` },
          { code: 'c', value: 'Test Author' },
        ],
      },
    ],
  };
}

/**
 * Create a buffer containing multiple MARC records concatenated.
 *
 * @param count - Number of records to generate
 * @returns Uint8Array containing serialized MARC records
 */
export function createMultiRecordBuffer(count: number): Uint8Array {
  const records = Array.from({ length: count }, (_, i) =>
    createTypicalRecord(String(i).padStart(8, '0'))
  );

  const buffers = records.map(serializeMarcRecord);
  const totalLength = buffers.reduce((sum, buf) => sum + buf.length, 0);

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const buf of buffers) {
    result.set(buf, offset);
    offset += buf.length;
  }

  return result;
}

/**
 * Create a single serialized MARC record.
 *
 * @param record - MarcRecord to serialize
 * @returns Uint8Array containing serialized record
 */
export function serializeRecord(record: MarcRecord): Uint8Array {
  return serializeMarcRecord(record);
}
