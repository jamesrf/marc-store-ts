import { isControlField, isDataField } from 'marc-ts';
import type { MarcRecord } from 'marc-ts';
import type { ReadableStore, EditableStore } from './types.js';

/**
 * Apply a transform function to every record in the store.
 * The transform receives the current record (including any overlay edits) and
 * returns a replacement, which is written back via setRecord.
 *
 * @returns Number of records processed.
 */
export function applyToAll(
  store: EditableStore,
  fn: (record: MarcRecord) => MarcRecord,
): number {
  const entries = Array.from(store.iterateRecords());
  for (const { index, record } of entries) {
    store.setRecord(index, fn(record));
  }
  return entries.length;
}

/**
 * Apply a transform function only to records matching a predicate.
 * The predicate is called once per record and must not mutate the store.
 *
 * @returns Number of records that matched and were written back.
 */
export function applyToMatching(
  store: EditableStore,
  predicate: (record: MarcRecord) => boolean,
  fn: (record: MarcRecord) => MarcRecord,
): number {
  const entries = Array.from(store.iterateRecords());
  let count = 0;
  for (const { index, record } of entries) {
    if (predicate(record)) {
      store.setRecord(index, fn(record));
      count++;
    }
  }
  return count;
}

/**
 * Delete all records for which the predicate returns true.
 *
 * @returns Number of records deleted.
 */
export function deleteMatching(
  store: EditableStore,
  predicate: (record: MarcRecord) => boolean,
): number {
  const toDelete: number[] = [];
  for (const { index, record } of store.iterateRecords()) {
    if (predicate(record)) {
      toDelete.push(index);
    }
  }
  // Delete highest index first so lower indices remain stable.
  toDelete.sort((a, b) => b - a);
  for (const index of toDelete) {
    store.deleteRecord(index);
  }
  return toDelete.length;
}

/**
 * Delete all records for which the predicate returns false, keeping only those
 * for which it returns true.
 *
 * @returns Number of records deleted.
 */
export function keepMatching(
  store: EditableStore,
  predicate: (record: MarcRecord) => boolean,
): number {
  return deleteMatching(store, record => !predicate(record));
}

/**
 * Serialize all records in the store to a single MARC21 binary buffer.
 * Unmodified records are zero-copied from the original buffer.
 */
export function toMarcBinary(store: ReadableStore): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (const chunk of store.iterateSerializedRecords()) {
    chunks.push(chunk);
    total += chunk.length;
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function escapeXml(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '�')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface ToMarcXmlOptions {
  encoding?: string;
}

/**
 * Serialize all records in the store to a MARCXML string.
 * Follows the Library of Congress MARCXML schema.
 * Special characters in field data are XML-escaped.
 */
export function toMarcXml(store: ReadableStore, options?: ToMarcXmlOptions): string {
  const { encoding = 'UTF-8' } = options ?? {};
  const lines: string[] = [
    `<?xml version="1.0" encoding="${encoding}"?>`,
    '<collection xmlns="http://www.loc.gov/MARC21/slim">',
  ];

  for (const { record } of store.iterateRecords()) {
    lines.push('  <record>');
    lines.push(`    <leader>${escapeXml(record.leader)}</leader>`);
    for (const field of record.fields) {
      if (isControlField(field)) {
        lines.push(`    <controlfield tag="${field.tag}">${escapeXml(field.data)}</controlfield>`);
      } else if (isDataField(field)) {
        lines.push(
          `    <datafield tag="${field.tag}" ind1="${field.indicator1}" ind2="${field.indicator2}">`,
        );
        for (const sub of field.subfields) {
          lines.push(`      <subfield code="${sub.code}">${escapeXml(sub.value)}</subfield>`);
        }
        lines.push('    </datafield>');
      }
    }
    lines.push('  </record>');
  }

  lines.push('</collection>');
  return lines.join('\n');
}

export interface ToJsonOptions {
  pretty?: boolean;
}

/**
 * Serialize all records in the store to a JSON string.
 * Each record is represented as `{ leader, fields }` where each field is
 * either `{ tag, data }` (control) or `{ tag, indicator1, indicator2, subfields }` (data).
 */
export function toJson(store: ReadableStore, options?: ToJsonOptions): string {
  const { pretty = false } = options ?? {};
  const records = Array.from(store.iterateRecords()).map(({ record }) => ({
    leader: record.leader,
    fields: record.fields.map(field => {
      if (isControlField(field)) {
        return { tag: field.tag, data: field.data };
      }
      return {
        tag: field.tag,
        indicator1: field.indicator1,
        indicator2: field.indicator2,
        subfields: field.subfields.map(s => ({ code: s.code, value: s.value })),
      };
    }),
  }));
  return pretty ? JSON.stringify(records, null, 2) : JSON.stringify(records);
}
