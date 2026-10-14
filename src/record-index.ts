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
 * - `skipped`: in recover mode, bytes that were skipped to resynchronise
 */
export interface IndexIssue {
  kind:
    | 'truncated-length'
    | 'invalid-length'
    | 'too-short'
    | 'overflow'
    | 'missing-terminator'
    | 'skipped';
  offset: number;
  message: string;
}

export interface ScanOptions {
  /**
   * When true, an invalid record is skipped by resynchronising on the next
   * 0x1D record terminator instead of stopping. Default false.
   */
  recover?: boolean;
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
 * Reads only each record's 5-byte leader length (plus its last byte to check
 * for the record terminator); record content is not parsed. Whitespace
 * between records is skipped.
 *
 * Never throws and never logs. Without `recover`, scanning stops at the first
 * invalid record; check `issues` (or compare `bytesConsumed` with the buffer
 * length) to detect a partial index.
 */
export function scanBuffer(
  buffer: ArrayBuffer | Uint8Array,
  options: ScanOptions = {}
): ScanResult {
  const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const { recover = false, onIssue } = options;
  const index: RecordIndex[] = [];
  const issues: IndexIssue[] = [];
  const report = (kind: IndexIssue['kind'], offset: number, message: string): void => {
    const issue = { kind, offset, message };
    issues.push(issue);
    onIssue?.(issue);
  };

  let offset = 0;
  while (offset < view.length) {
    if (isInterRecordWhitespace(view[offset]!)) {
      offset++;
      continue;
    }

    const problem = checkRecordAt(view, offset);
    if (problem === null) {
      const recordLength = readLength(view, offset);
      if (view[offset + recordLength - 1] !== RECORD_TERMINATOR) {
        report(
          'missing-terminator',
          offset,
          `indexBuffer: Record at offset ${offset} (length ${recordLength}) does not end with the 0x1D record terminator.`
        );
      }
      index.push({ offset, length: recordLength });
      offset += recordLength;
      continue;
    }

    if (!recover) {
      report(problem.kind, offset, `${problem.message} Stopping.`);
      break;
    }

    // Recover: skip past the next record terminator and carry on from there.
    report(problem.kind, offset, `${problem.message} Skipping to next record terminator.`);
    const terminator = view.indexOf(RECORD_TERMINATOR, offset);
    const resumeAt = terminator === -1 ? view.length : terminator + 1;
    report(
      'skipped',
      offset,
      `indexBuffer: Skipped ${resumeAt - offset} bytes at offset ${offset}.`
    );
    offset = resumeAt;
  }

  return { index, issues, bytesConsumed: offset };
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
 *
 * Equivalent to `scanBuffer(buffer, options).index`. For backward
 * compatibility, issues are logged with `console.warn` unless an `onIssue`
 * callback is supplied; use `scanBuffer` to get the issues back as data.
 *
 * @param buffer - Raw MARC file
 * @returns Array of {offset, length} for each valid record found
 */
export function indexBuffer(
  buffer: ArrayBuffer | Uint8Array,
  options: ScanOptions = {}
): RecordIndex[] {
  return scanBuffer(buffer, {
    ...options,
    onIssue: options.onIssue ?? ((issue) => console.warn(issue.message)),
  }).index;
}
