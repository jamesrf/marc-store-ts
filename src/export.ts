import { isControlField, isDataField } from 'marc-ts';
import type { MarcRecord } from 'marc-ts';
import { serializeMarcJson } from 'marc-ts/json';
import type { ReadableStore } from './types.js';
import { iterateReadableRecords } from './iterate.js';
import type { RecordErrorOptions } from './iterate.js';

/**
 * Serialize all records in the store to a single MARC21 binary buffer.
 * Unmodified records are copied byte-for-byte from the original buffer
 * without being parsed, so records that would fail to parse are still
 * written unchanged.
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
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '�')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Records parsed from MARC-8 keep leader/09 = ' ', but their text is already
 * Unicode (marc-ts converts MARC-8 while parsing). Text exports are always
 * Unicode, so mark them as such.
 */
function unicodeLeader(leader: string): string {
  return leader.length > 9 && leader[9] === ' '
    ? `${leader.slice(0, 9)}a${leader.slice(10)}`
    : leader;
}

export type ToMarcXmlOptions = RecordErrorOptions;

/**
 * Serialize all records in the store to MARCXML (UTF-8), one chunk at a time:
 * the XML declaration and opening `<collection>`, then one chunk per record,
 * then the closing tag. Joined, the chunks equal `toMarcXml(store)`. Use it
 * to write large files without holding the whole document in memory.
 *
 * Follows the Library of Congress MARCXML schema; special characters are
 * XML-escaped. Records parsed from MARC-8 are written as Unicode with
 * leader/09 set to `a`. Records that cannot be parsed are handled per
 * `options.onError`.
 */
export function* iterateMarcXml(
  store: ReadableStore,
  options: ToMarcXmlOptions = {}
): Generator<string> {
  yield '<?xml version="1.0" encoding="UTF-8"?>\n<collection xmlns="http://www.loc.gov/MARC21/slim">';
  for (const { record } of iterateReadableRecords(store, options.onError)) {
    const lines: string[] = ['', '  <record>'];
    lines.push(`    <leader>${escapeXml(unicodeLeader(record.leader))}</leader>`);
    for (const field of record.fields) {
      if (isControlField(field)) {
        lines.push(
          `    <controlfield tag="${escapeXml(field.tag)}">${escapeXml(field.data)}</controlfield>`
        );
      } else if (isDataField(field)) {
        lines.push(
          `    <datafield tag="${escapeXml(field.tag)}" ind1="${escapeXml(field.indicator1)}" ind2="${escapeXml(field.indicator2)}">`
        );
        for (const sub of field.subfields) {
          lines.push(
            `      <subfield code="${escapeXml(sub.code)}">${escapeXml(sub.value)}</subfield>`
          );
        }
        lines.push('    </datafield>');
      }
    }
    lines.push('  </record>');
    yield lines.join('\n');
  }
  yield '\n</collection>';
}

/**
 * Serialize all records in the store to a MARCXML string. See
 * `iterateMarcXml` to stream the output instead.
 */
export function toMarcXml(store: ReadableStore, options?: ToMarcXmlOptions): string {
  return Array.from(iterateMarcXml(store, options)).join('');
}

export interface ToJsonOptions extends RecordErrorOptions {
  /**
   * - `'marc-in-json'` (default): the community-standard MARC-in-JSON format,
   *   e.g. `{ "245": { "ind1": "1", "ind2": "0", "subfields": [{ "a": "..." }] } }`
   * - `'simple'`: `{ tag, data }` / `{ tag, indicator1, indicator2, subfields: [{ code, value }] }`
   */
  format?: 'marc-in-json' | 'simple';
  /** Indent with 2 spaces. Ignored with `ndjson`. */
  pretty?: boolean;
  /** Newline-delimited JSON: one record per line, with no enclosing array. */
  ndjson?: boolean;
}

function toSimpleJson(record: MarcRecord): object {
  return {
    leader: unicodeLeader(record.leader),
    fields: record.fields.map((field) => {
      if (isControlField(field)) {
        return { tag: field.tag, data: field.data };
      }
      return {
        tag: field.tag,
        indicator1: field.indicator1,
        indicator2: field.indicator2,
        subfields: field.subfields.map((s) => ({ code: s.code, value: s.value })),
      };
    }),
  };
}

function toMarcInJson(record: MarcRecord): object {
  return serializeMarcJson([{ ...record, leader: unicodeLeader(record.leader) }])[0]!;
}

/**
 * Serialize all records in the store to JSON, one chunk at a time (one per
 * record, plus the enclosing brackets for array output). Joined, the chunks
 * equal `toJson(store, options)`. Use it to write large files without
 * holding the whole document in memory.
 *
 * Records parsed from MARC-8 are written as Unicode with leader/09 set to
 * `a`. Records that cannot be parsed are handled per `options.onError`.
 */
export function* iterateJson(store: ReadableStore, options: ToJsonOptions = {}): Generator<string> {
  const { format = 'marc-in-json', pretty = false, ndjson = false, onError } = options;
  const convert = format === 'simple' ? toSimpleJson : toMarcInJson;
  let first = true;
  for (const { record } of iterateReadableRecords(store, onError)) {
    const obj = convert(record);
    if (ndjson) {
      yield `${JSON.stringify(obj)}\n`;
    } else if (pretty) {
      // Matches JSON.stringify(array, null, 2): each element indented 2 spaces.
      yield `${first ? '[\n' : ',\n'}  ${JSON.stringify(obj, null, 2).replace(/\n/g, '\n  ')}`;
    } else {
      yield `${first ? '[' : ','}${JSON.stringify(obj)}`;
    }
    first = false;
  }
  if (!ndjson) yield first ? '[]' : pretty ? '\n]' : ']';
}

/**
 * Serialize all records in the store to a JSON string: MARC-in-JSON by
 * default (see `ToJsonOptions.format`). See `iterateJson` to stream the
 * output instead.
 */
export function toJson(store: ReadableStore, options?: ToJsonOptions): string {
  return Array.from(iterateJson(store, options)).join('');
}
