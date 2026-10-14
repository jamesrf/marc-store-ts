import type { MarcRecord } from 'marc-ts';
import type { EditableStore } from './types.js';
import { iterateReadableRecords } from './iterate.js';
import type { RecordErrorOptions } from './iterate.js';

/**
 * Apply a transform function to every record in the store.
 * The transform receives the current record (including any overlay edits) and
 * returns a replacement, which is written back via setRecord.
 *
 * Records that cannot be parsed are handled per `options.onError`; skipped
 * records are left unchanged.
 *
 * @returns Number of records processed.
 */
export function applyToAll(
  store: EditableStore,
  fn: (record: MarcRecord) => MarcRecord,
  options: RecordErrorOptions = {}
): number {
  let count = 0;
  for (const { index, record } of iterateReadableRecords(store, options.onError)) {
    store.setRecord(index, fn(record));
    count++;
  }
  return count;
}

/**
 * Apply a transform function only to records matching a predicate.
 * The predicate is called once per record and must not mutate the store.
 *
 * Records that cannot be parsed are handled per `options.onError`; skipped
 * records are left unchanged.
 *
 * @returns Number of records that matched and were written back.
 */
export function applyToMatching(
  store: EditableStore,
  predicate: (record: MarcRecord) => boolean,
  fn: (record: MarcRecord) => MarcRecord,
  options: RecordErrorOptions = {}
): number {
  let count = 0;
  for (const { index, record } of iterateReadableRecords(store, options.onError)) {
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
 * Records that cannot be parsed are handled per `options.onError`; skipped
 * records are kept.
 *
 * @returns Number of records deleted.
 */
export function deleteMatching(
  store: EditableStore,
  predicate: (record: MarcRecord) => boolean,
  options: RecordErrorOptions = {}
): number {
  const toDelete: number[] = [];
  for (const { index, record } of iterateReadableRecords(store, options.onError)) {
    if (predicate(record)) {
      toDelete.push(index);
    }
  }
  store.deleteRecords(toDelete);
  return toDelete.length;
}

/**
 * Delete all records for which the predicate returns false, keeping only those
 * for which it returns true.
 *
 * Records that cannot be parsed are handled per `options.onError`; skipped
 * records are kept, since the predicate could not be evaluated.
 *
 * @returns Number of records deleted.
 */
export function keepMatching(
  store: EditableStore,
  predicate: (record: MarcRecord) => boolean,
  options: RecordErrorOptions = {}
): number {
  return deleteMatching(store, (record) => !predicate(record), options);
}

export {
  toMarcBinary,
  toMarcXml,
  toJson,
  iterateMarcBinary,
  iterateMarcXml,
  iterateJson,
} from './export.js';
export type { ToMarcBinaryOptions, ToMarcXmlOptions, ToJsonOptions } from './export.js';
