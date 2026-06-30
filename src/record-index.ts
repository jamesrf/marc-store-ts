/**
 * Record index entry representing position and size of a MARC record.
 */
export interface RecordIndex {
  offset: number; // Byte position where record starts
  length: number; // Record length in bytes
}

/**
 * Scan a MARC file buffer and build a lightweight index of record boundaries.
 *
 * MARC21 format: Each record starts with a 5-byte ASCII length field in the leader.
 * This function reads only the length fields, without parsing record content.
 *
 * @param buffer - Raw MARC file as ArrayBuffer
 * @returns Array of {offset, length} for each valid record found
 *
 * Error handling:
 * - Truncated length field: warns and stops
 * - Invalid (non-numeric) length: warns and stops
 * - Record overflow: warns and stops
 * - Returns partial index on errors (doesn't throw)
 */
export function indexBuffer(buffer: ArrayBuffer | Uint8Array): RecordIndex[] {
  const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const index: RecordIndex[] = [];
  let offset = 0;

  // Handle empty buffer
  if (view.length === 0) {
    return index;
  }

  const decoder = new TextDecoder('ascii');

  while (offset < view.length) {
    // Check bounds: need at least 5 bytes for length field
    if (offset + 5 > view.length) {
      console.warn(
        `indexBuffer: Truncated length field at offset ${offset} ` +
          `(need 5 bytes, have ${view.length - offset}). Stopping.`
      );
      break;
    }

    // Read bytes[offset:offset+5] as ASCII string
    const lengthBytes = view.subarray(offset, offset + 5);
    const lengthStr = decoder.decode(lengthBytes);

    // Validate: exactly 5 ASCII digits before parsing
    if (!/^\d{5}$/.test(lengthStr)) {
      console.warn(
        `indexBuffer: Invalid (non-numeric) length "${lengthStr}" at offset ${offset}. Stopping.`
      );
      break;
    }

    const recordLength = parseInt(lengthStr, 10);

    // Validate: >= 24 (minimum valid MARC record)
    if (recordLength < 24) {
      console.warn(
        `indexBuffer: Record length ${recordLength} < 24 bytes at offset ${offset}. Stopping.`
      );
      break;
    }

    // Validate: offset + recordLength <= buffer.length (no overflow)
    if (offset + recordLength > view.length) {
      console.warn(
        `indexBuffer: Record at offset ${offset} (length ${recordLength}) ` +
          `would overflow buffer (size ${view.length}). Stopping.`
      );
      break;
    }

    // Valid record: add to index
    index.push({ offset, length: recordLength });

    // Advance to next record
    offset += recordLength;
  }

  return index;
}
