import type { MarcRecord } from 'marc-ts';
import type { ReadableStore, RecordResult } from './types.js';

/**
 * What to do when a record cannot be read (typically a parse failure):
 *
 * - `'throw'` (default): stop and rethrow the error
 * - `'skip'`: leave the record out and carry on
 * - a callback: called with the record's position and error message, then
 *   the record is skipped
 */
export type OnRecordError = 'throw' | 'skip' | ((position: number, error: string) => void);

export interface RecordErrorOptions {
  onError?: OnRecordError;
}

/**
 * Iterate every position in `store`, yielding a `RecordResult` instead of
 * throwing when a record cannot be parsed.
 */
export function* iterateRecordResults(
  store: ReadableStore
): Generator<{ index: number; result: RecordResult }> {
  const total = store.totalRecords;
  for (let index = 0; index < total; index++) {
    yield { index, result: store.tryGetRecord(index) };
  }
}

/**
 * Iterate the records in `store`, applying `onError` to records that cannot
 * be read. With `'throw'` this is exactly `store.iterateRecords()`.
 */
export function* iterateReadableRecords(
  store: ReadableStore,
  onError: OnRecordError = 'throw'
): Generator<{ index: number; record: MarcRecord }> {
  if (onError === 'throw') {
    yield* store.iterateRecords();
    return;
  }
  for (const { index, result } of iterateRecordResults(store)) {
    if (result.ok) {
      yield { index, record: result.record };
    } else if (typeof onError === 'function') {
      onError(index, result.error);
    }
  }
}
