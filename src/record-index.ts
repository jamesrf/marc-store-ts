/**
 * Record index entry representing position and size of a MARC record.
 */
export interface RecordIndex {
  offset: number; // Byte position where record starts
  length: number; // Record length in bytes
}

/**
 * A problem found while scanning a MARC buffer.
 *
 * - `truncated-length`: fewer than 5 bytes left for a leader length field
 * - `invalid-length`: the 5-byte length field is not all ASCII digits
 * - `too-short`: the declared length is below the 24-byte MARC minimum
 * - `overflow`: the declared length runs past the end of the buffer
 * - `missing-terminator`: the record does not end with the 0x1D record terminator
 *   (the record is still indexed; it may fail to parse)
 * - `length-mismatch`: the leader length disagrees with the record terminator;
 *   the record is indexed using the terminator, and the store corrects the
 *   leader length when parsing and writing it
 * - `skipped`: bytes ending in a terminator that were too short to be a record
 *
 * The first four kinds are only reported when scanning stops because no
 * record terminator follows; otherwise the record is indexed by its
 * terminator and reported as `length-mismatch`.
 */
export interface IndexIssue {
  kind:
    | 'truncated-length'
    | 'invalid-length'
    | 'too-short'
    | 'overflow'
    | 'missing-terminator'
    | 'length-mismatch'
    | 'skipped';
  offset: number;
  message: string;
  /** For `length-mismatch`: the leader's length field as found (up to 5 characters). */
  declaredLength?: string;
  /** For `length-mismatch` and `skipped`: the actual number of bytes. */
  length?: number;
}

export interface ScanOptions {
  /** Called for each issue as it is found. */
  onIssue?: (issue: IndexIssue) => void;
}

export interface ScanResult {
  /** Records found, in file order. */
  index: RecordIndex[];
  /** Every problem found, in file order. Empty for a clean file. */
  issues: IndexIssue[];
  /**
   * Bytes accounted for (records plus skipped bytes and inter-record whitespace).
   * Less than the buffer length when scanning stopped early.
   */
  bytesConsumed: number;
}

const RECORD_TERMINATOR = 0x1d;
const MIN_RECORD_LENGTH = 24;

// Some exports put newlines (or other whitespace) between records.
function isInterRecordWhitespace(byte: number): boolean {
  return byte === 0x0a || byte === 0x0d || byte === 0x20 || byte === 0x09 || byte === 0x00;
}

function isDigit(byte: number): boolean {
  return byte >= 0x30 && byte <= 0x39;
}

/**
 * Scan a MARC21 buffer and build an index of record boundaries, reporting
 * any problems found instead of only logging them.
 *
 * Uses each record's 5-byte leader length, cross-checked against the 0x1D
 * record terminator; record content is not parsed. Whitespace between
 * records is skipped. When the leader length is wrong, the terminator is used
 * as the record boundary instead (reported as `length-mismatch`).
 *
 * Never throws and never logs. Scanning stops only when a record's length is
 * unusable and no record terminator follows; check `issues` (or compare
 * `bytesConsumed` with the buffer length) to detect a partial index.
 */
export function scanBuffer(
  buffer: ArrayBuffer | Uint8Array,
  options: ScanOptions = {}
): ScanResult {
  const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const { onIssue } = options;
  const index: RecordIndex[] = [];
  const issues: IndexIssue[] = [];
  const report = (issue: IndexIssue): void => {
    issues.push(issue);
    onIssue?.(issue);
  };

  let offset = 0;
  while (offset < view.length) {
    if (isInterRecordWhitespace(view[offset]!)) {
      offset++;
      continue;
    }

    // A well-formed record contains exactly one terminator, as its last byte.
    const terminator = view.indexOf(RECORD_TERMINATOR, offset);
    const problem = checkRecordAt(view, offset);
    const declared = problem === null ? readLength(view, offset) : -1;
    const declaredEnd = offset + declared - 1;

    if (problem === null && terminator === declaredEnd) {
      index.push({ offset, length: declared });
      offset += declared;
      continue;
    }

    // Usable length but no terminator where expected. Trust the length if it
    // lands on a valid boundary (or no terminator follows at all), so a record
    // that merely lacks its terminator doesn't swallow the next one.
    if (
      problem === null &&
      (terminator === -1 || (terminator > declaredEnd && isRecordBoundary(view, offset + declared)))
    ) {
      report({
        kind: 'missing-terminator',
        offset,
        message: `indexBuffer: Record at offset ${offset} (length ${declared}) does not end with the 0x1D record terminator.`,
      });
      index.push({ offset, length: declared });
      offset += declared;
      continue;
    }

    if (terminator === -1) {
      report({ kind: problem!.kind, offset, message: `${problem!.message} Stopping.` });
      break;
    }

    // The leader length is wrong; the terminator marks the real end.
    const actual = terminator + 1 - offset;
    const declaredLength = String.fromCharCode(
      ...view.subarray(offset, Math.min(offset + 5, view.length))
    );
    if (actual < MIN_RECORD_LENGTH) {
      report({
        kind: 'skipped',
        offset,
        length: actual,
        message: `indexBuffer: Skipped ${actual} bytes at offset ${offset} (too short to be a record).`,
      });
    } else {
      report({
        kind: 'length-mismatch',
        offset,
        declaredLength,
        length: actual,
        message: `indexBuffer: Record at offset ${offset} has leader length "${declaredLength}" but ends at the record terminator after ${actual} bytes. Using ${actual}.`,
      });
      index.push({ offset, length: actual });
    }
    offset = terminator + 1;
  }

  return { index, issues, bytesConsumed: offset };
}

/** True at end of buffer (ignoring trailing whitespace) or at a well-formed record. */
function isRecordBoundary(view: Uint8Array, offset: number): boolean {
  while (offset < view.length && isInterRecordWhitespace(view[offset]!)) offset++;
  if (offset >= view.length) return true;
  if (checkRecordAt(view, offset) !== null) return false;
  const end = offset + readLength(view, offset) - 1;
  return view.indexOf(RECORD_TERMINATOR, offset) === end;
}

function readLength(view: Uint8Array, offset: number): number {
  let n = 0;
  for (let i = 0; i < 5; i++) n = n * 10 + (view[offset + i]! - 0x30);
  return n;
}

function checkRecordAt(
  view: Uint8Array,
  offset: number
): { kind: IndexIssue['kind']; message: string } | null {
  if (offset + 5 > view.length) {
    return {
      kind: 'truncated-length',
      message:
        `indexBuffer: Truncated length field at offset ${offset} ` +
        `(need 5 bytes, have ${view.length - offset}).`,
    };
  }
  for (let i = 0; i < 5; i++) {
    if (!isDigit(view[offset + i]!)) {
      const lengthStr = String.fromCharCode(...view.subarray(offset, offset + 5));
      return {
        kind: 'invalid-length',
        message: `indexBuffer: Invalid (non-numeric) length "${lengthStr}" at offset ${offset}.`,
      };
    }
  }
  const recordLength = readLength(view, offset);
  if (recordLength < MIN_RECORD_LENGTH) {
    return {
      kind: 'too-short',
      message: `indexBuffer: Record length ${recordLength} < 24 bytes at offset ${offset}.`,
    };
  }
  if (offset + recordLength > view.length) {
    return {
      kind: 'overflow',
      message:
        `indexBuffer: Record at offset ${offset} (length ${recordLength}) ` +
        `would overflow buffer (size ${view.length}).`,
    };
  }
  return null;
}

/**
 * Scan a MARC file buffer and build a lightweight index of record boundaries.
 * Equivalent to `scanBuffer(buffer, options).index`: issues are discarded
 * unless an `onIssue` callback is supplied, so prefer `scanBuffer` when you
 * need to know whether the index is complete.
 *
 * @param buffer - Raw MARC file
 * @returns Array of {offset, length} for each record found
 */
export function indexBuffer(
  buffer: ArrayBuffer | Uint8Array,
  options: ScanOptions = {}
): RecordIndex[] {
  return scanBuffer(buffer, options).index;
}
