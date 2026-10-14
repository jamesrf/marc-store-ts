# marc-store-ts

> Efficient storage and management for large MARC (Machine Readable Cataloging) files

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A TypeScript library designed to handle large MARC bibliographic files (50K-250K records, 70-250MB+) with intelligent caching, lazy parsing, and copy-on-write editing capabilities.

## Features

- **Efficient Storage**: Handle 50K-250K MARC records with minimal memory footprint
- **Intelligent LRU Caching**: Recently accessed records stay in memory for fast retrieval
- **Lazy Parsing**: Records are only parsed when accessed, reducing startup time
- **Copy-on-Write Editing**: Edit records without modifying the original buffer
- **Zero-Copy Serialization**: Unmodified records are serialized as buffer views (no re-parsing)
- **Type-Safe API**: Uses discriminated unions for safe error handling
- **Full-Text Search**: Pure-JS `SearchIndex` for querying by title, author, subject, or any custom field combination — works identically in Node and the browser

## Installation

```bash
npm install marc-store-ts marc-ts
```

```bash
yarn add marc-store-ts marc-ts
```

> **Note**: `marc-ts` is a peer dependency required for MARC parsing and serialization.

## Quick Start

```typescript
import { readFileSync } from 'fs';
import { MarcFile } from 'marc-store-ts';

// Load MARC file and create store in one step
const store = MarcFile.fromBuffer(readFileSync('catalog.mrc'));

// Access records
const record = store.getRecord(0);
console.log(`Total records: ${store.totalRecords}`);
```

## Architecture

`MarcFile` is a thin facade over two classes:

```
MarcFile
├── EditLayer   slot array (original / modified / deleted / inserted) — copy-on-write edits
└── MarcBase    raw buffer + record index (offset/length per record) + LRU cache of parsed records
```

`indexBuffer()` scans the raw buffer once, reading only each record's 5-byte length, to build the record index. Records are parsed on first access and cached.

**Record retrieval**: an edited slot returns its stored record; an original slot is served from the LRU cache, or parsed from the buffer on a miss.

This design ensures:
- The library never writes to the original buffer
- Only recently used records consume memory
- Edits are tracked separately without duplicating unmodified data
- Serialization can reuse original buffer data for unmodified records

## API Documentation

### MarcFile

The main storage engine for MARC files. `MarcFile` is an `EditLayer` (copy-on-write edits) over a `MarcBase` (the raw buffer, record index and LRU cache), so every method below is also available on `EditLayer`.

#### Static factory

```typescript
static fromBuffer(
  buffer: Uint8Array | ArrayBuffer,
  options?: number | FromBufferOptions
): MarcFile

interface FromBufferOptions {
  cacheCapacity?: number;                  // LRU cache size (default 200)
  onIssue?: (issue: IndexIssue) => void;   // replaces the default console.warn
  copyBuffer?: boolean;                    // copy the buffer instead of referencing it (default false)
}
```

Convenience factory — indexes the buffer with [`scanBuffer()`](#scanbuffer) and constructs the store in one call. A plain number is still accepted as the cache capacity.

By default the store keeps a reference to your buffer rather than copying it, so **don't write to the buffer after creating the store**. Pass `copyBuffer: true` if you need to reuse that memory; it doubles peak memory while loading.

Any indexing problems are available afterwards as `store.indexIssues`. **If it is non-empty, the file may be only partially indexed**, and exporting the store would drop the unindexed records:

```typescript
import { MarcFile } from 'marc-store-ts';
const store = MarcFile.fromBuffer(readFileSync('catalog.mrc'), { onIssue: () => {} });
if (store.indexIssues.length > 0) {
  console.error(`Indexed ${store.totalRecords} records with problems:`, store.indexIssues);
}
```

#### Constructor

```typescript
constructor(
  rawBuffer: ArrayBuffer | Uint8Array,
  recordIndex: RecordIndex[],
  cacheCapacity = 200
)
```

**Parameters:**
- `rawBuffer`: The complete MARC file as a `Uint8Array` or `ArrayBuffer`
- `recordIndex`: Array of record positions (use `indexBuffer()` to generate)
- `cacheCapacity`: Maximum number of records to keep in LRU cache (default: 200)

#### Properties

```typescript
totalRecords: number                       // Total number of records in the file
modifiedCount: number                      // Number of edited records
slots: readonly Readonly<RecordSlot>[]     // Deprecated: copies every slot on each access; use getSlot/iterateSlots
base: MarcBase                             // Advanced: underlying buffer and LRU cache layer
indexIssues: readonly IndexIssue[]         // Problems found while indexing (see scanBuffer)
```

#### Methods

##### getRecord(index: number): MarcRecord

Retrieves a record by index. **Throws** if record doesn't exist or cannot be parsed.

```typescript
const record = store.getRecord(0);
```

##### tryGetRecord(index: number): RecordResult

Safe variant that never throws. Returns a discriminated union:

```typescript
const result = store.tryGetRecord(0);
if (result.ok) {
  console.log('Record:', result.record);
} else {
  console.error('Error:', result.error);
}
```

**Return Type:**
```typescript
type RecordResult =
  | { ok: true; record: MarcRecord }
  | { ok: false; error: string }
```

##### setRecord(index: number, record: MarcRecord): void

Updates a record. Changes are stored in the edit layer (copy-on-write). The store keeps a deep-frozen copy, so your object is not modified and later changes to it do not affect the store; already-frozen parts (such as fields carried over from a record you read from the store) are reused rather than copied.

```typescript
store.setRecord(0, modifiedRecord);
console.log(store.modifiedCount); // 1
```

##### isModified(index: number): boolean

Check if a specific record has been edited.

```typescript
if (store.isModified(0)) {
  console.log('Record 0 has been modified');
}
```

##### revertRecord(index: number): void

Reverts a modified record back to its original state. Has no effect on unmodified or inserted records (use `deleteRecord` to remove an inserted record).

> **Note:** a deleted record no longer has a position, so `revertRecord` cannot restore it: `revertRecord(i)` after `deleteRecord(i)` acts on whichever record has moved into position `i`. To undo a deletion, use [`revert(id)`](#stable-record-ids) with the record's ID.

```typescript
store.revertRecord(0);
```

##### deleteRecord(index: number): void

Marks a record as deleted in the edit layer. Deleted records are excluded from `totalRecords` and `iterateRecords()`, and later records shift down one position. Restore it with [`revert(id)`](#stable-record-ids) (note the ID with `store.idAt(index)` before deleting) or `revertAll()`.

```typescript
store.deleteRecord(5);
console.log(store.totalRecords); // one fewer than before
```

##### insertRecord(record: MarcRecord, afterPosition?: number): void

Inserts a new record into the edit layer. If `afterPosition` is omitted, the record is appended to the end. As with `setRecord`, the store keeps a frozen copy and does not modify your object.

```typescript
store.insertRecord(newRecord);               // append
store.insertRecord(newRecord, 3);            // insert after position 3
```

##### deleteRecords(positions: Iterable\<number>): void / insertRecords(records: Iterable\<MarcRecord>, afterPosition?: number): void

Bulk versions of `deleteRecord` and `insertRecord` that do a single pass over the store, so they stay fast for large batches. Each `deleteRecord` or `insertRecord` call costs time proportional to the file size (about 1 ms at 250K records); prefer the bulk forms when changing many records at once.

`deleteRecords` positions refer to the store as it was before the call, may be in any order, and duplicates are ignored. If any position is out of range it throws `RangeError` and deletes nothing.

```typescript
store.deleteRecords([2, 7, 9]);                       // positions before the call
store.insertRecords([recordA, recordB], 0);           // after position 0, in order
```

##### getSerializedRecord(index: number): Uint8Array

Returns the serialized binary representation of a single record, as a new `Uint8Array` you may modify freely (a copy of the original bytes for an unmodified record). For zero-copy access when writing a file, use `iterateSerializedRecords()`.

```typescript
const bytes = store.getSerializedRecord(0);
```

##### *iterateRecords(): Generator<{ index: number; record: MarcRecord }>

Iterates over all active (non-deleted) records, yielding `{ index, record }` pairs where `index` is the 0-based position among active records.

```typescript
for (const { index, record } of store.iterateRecords()) {
  console.log(index, record.leader);
}
```

##### *iterateSerializedRecords(): Generator<Uint8Array>

Serializes all records (modified and unmodified) for saving to a file.

This yields each unmodified record's **original bytes**, including MARC-8 ones; use `iterateMarcBinary()` for UTF-8 output.

**Zero-copy optimization**: Unmodified records yield Uint8Array views into the original buffer without re-parsing. These views share memory with the store, so treat them as read-only: writing to one corrupts the store. Records whose leader length was wrong (see [`scanBuffer()`](#scanbuffer)) are yielded as copies with the length corrected.

```typescript
import { writeFileSync } from 'fs';

// Collect serialized chunks
const chunks = Array.from(store.iterateSerializedRecords());

// Concatenate and save
const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
const output = new Uint8Array(totalLength);
let offset = 0;
for (const chunk of chunks) {
  output.set(chunk, offset);
  offset += chunk.length;
}
writeFileSync('modified-catalog.mrc', output);
```

### scanBuffer()

Scans a MARC file buffer and builds a lightweight index of record boundaries, returning any problems as data. It uses each record's 5-byte leader length, cross-checked against the `0x1D` record terminator; record content is not parsed. It never throws and never logs.

```typescript
function scanBuffer(buffer: Uint8Array | ArrayBuffer, options?: ScanOptions): ScanResult

interface ScanOptions {
  onIssue?: (issue: IndexIssue) => void;  // called as each issue is found
}

interface ScanResult {
  index: RecordIndex[];    // records found, in file order
  issues: IndexIssue[];    // empty for a clean file
  bytesConsumed: number;   // less than buffer.length if scanning stopped early
}

interface IndexIssue {
  kind: 'truncated-length' | 'invalid-length' | 'too-short' | 'overflow'
      | 'missing-terminator' | 'length-mismatch' | 'skipped';
  offset: number;
  message: string;
  declaredLength?: string;  // length-mismatch: the leader's length field as found
  length?: number;          // length-mismatch / skipped: the actual byte count
}
```

Behaviour:
- Whitespace between records (newlines, spaces, NUL padding), which some exports add, is skipped.
- **Wrong leader lengths** (too long, too short, past the end of the file, below 24, or not a number) are common in real files, for example after an encoding conversion. When the leader length disagrees with the record terminator, the terminator is used as the record boundary and a `length-mismatch` issue is reported. The store then parses the record with its leader length corrected, and writes it out corrected (only the 5 length digits change), so one bad length doesn't cost you that record or its neighbours.
- A record that is missing its `0x1D` but whose length lands on the start of a valid record (or the end of the file) keeps its declared length, with a `missing-terminator` issue.
- Bytes ending in a `0x1D` that are too short to be a record are reported as `skipped`, and scanning continues.
- Scanning stops only when a length is unusable and no record terminator follows; the original problem (`truncated-length`, `invalid-length`, `too-short` or `overflow`) is reported.

```typescript
const { index, issues } = scanBuffer(buffer);
console.log(`Indexed ${index.length} records, ${issues.length} issues`);
```

### indexBuffer()

```typescript
function indexBuffer(buffer: Uint8Array | ArrayBuffer, options?: ScanOptions): RecordIndex[]
```

Equivalent to `scanBuffer(buffer, options).index`. For backward compatibility, issues are logged with `console.warn` unless `onIssue` is supplied. Prefer `scanBuffer()` when you need to know whether the index is complete.

### RecordIndex

Interface representing the position and size of a MARC record:

```typescript
interface RecordIndex {
  offset: number;  // Byte position where record starts
  length: number;  // Record length in bytes
}
```

### Stable record IDs

Positions shift whenever records are inserted or deleted. Every record also has a **`RecordId`** (a number) that never changes and is never reused, so you can hold on to a record across edits. Original records' IDs equal their index in the file; inserted records get IDs counting up from the file's record count.

```typescript
idAt(position: number): RecordId                   // throws RangeError if out of range
positionOf(id: RecordId): number | undefined       // undefined if deleted or unknown
getRecordById(id: RecordId): MarcRecord            // throws RangeError if deleted or unknown
revert(id: RecordId): boolean                      // undo a modification or deletion
deletedIds(): RecordId[]                           // original records currently deleted
```

`revert(id)` restores a deleted record to its original place in the file, or a modified record to its original content (a record that was modified and then deleted comes back with its original content). It returns `true` if anything changed. Inserted records can't be reverted; delete them instead.

```typescript
const id = store.idAt(5);
store.deleteRecord(5);
store.insertRecord(newRecord, 0);      // positions shift, the ID doesn't
store.positionOf(id);                  // undefined: deleted
store.revert(id);                      // back again
store.positionOf(id);                  // 6: its original place, after the inserted record

// Undo every deletion:
for (const id of store.deletedIds()) store.revert(id);
```

### RecordSlot

Discriminated union representing the state of each record in the edit layer. Read one with `store.getSlot(position)` (undefined if out of range), or all of them, including deleted records, in file order with `store.iterateSlots()`. The older `store.slots` getter still works but copies every slot on each access, so avoid it on large files.

```typescript
type RecordSlot =
  | { kind: 'original'; id: RecordId; index: number }                      // Unmodified — points to original buffer
  | { kind: 'modified'; id: RecordId; index: number; record: MarcRecord }  // Edited in place
  | { kind: 'deleted'; id: RecordId; index: number }                       // Marked for deletion
  | { kind: 'inserted'; id: RecordId; record: MarcRecord }                 // Newly inserted (no original counterpart)
```

## Full-Text Search

`marc-store-ts` includes a `SearchIndex` class for full-text search over a store's records, built on [minisearch](https://github.com/lucaong/minisearch) — pure JavaScript, zero native dependencies, works identically in Node and the browser.

`SearchIndex` is additive: it's built from a snapshot of a store's records via `iterateRecords()` and never mutates the store. It's not wired into `MarcFile` automatically — you build one explicitly when you want search.

### Basic usage

```typescript
import { readFileSync } from 'fs';
import { MarcFile, SearchIndex } from 'marc-store-ts';

const store = MarcFile.fromBuffer(readFileSync('catalog.mrc'));

const index = new SearchIndex();
index.build(store);

const results = index.search('catcher rye');
for (const { position, score } of results) {
  console.log(position, score, store.getRecord(position));
}
```

By default, `SearchIndex` indexes four fields extracted with `marc-ts` helpers:

| Field | Source |
|---|---|
| `title` | 245 $a/$b |
| `author` | 100/110 $a (main entry) and 700 $a (added entries) |
| `subjects` | 6XX $a |
| `contents` | every subfield value, for general recall |

Titles and subjects are boosted higher than general contents by default (configurable via `boost`).

### Keeping the index in sync after edits

Results are keyed by each record's [stable ID](#stable-record-ids), and `search()` translates IDs into the store's **current** positions. Each result is `{ id, position, score, match }`. So:

- **Inserts and deletes need no action.** Positions in results follow the store, and deleted records drop out of the results (and come back if you `revert` them).
- **Content edits** (`setRecord`, `applyToAll`, ...) aren't seen until you re-index. For a few records, use `add(id, record)`; after a large batch, `rebuild(store)`:

```typescript
import { applyToAll } from 'marc-store-ts';

store.setRecord(5, edited);
index.add(store.idAt(5), store.getRecord(5));   // re-index one record

applyToAll(store, record => /* ... */ record);
index.rebuild(store);                            // re-index everything
```

Inserted records are not searchable until added: `index.add(store.idAt(position), record)`. `remove(id)` takes an entry out of the index; it isn't needed after a delete.

`SearchIndex` works with any `ReadableStore`. For a store without stable IDs, IDs are positions, and you should rebuild after inserts or deletes.

### Multiple, field-scoped indexes

`SearchIndex` instances are independent and cheap to create. Build several over the same store, each scoped to different fields, to get separately queryable indexes:

```typescript
const subjectIndex = new SearchIndex({
  fields: [{ name: 'subjects', extract: record => subjects(record) }],
});
subjectIndex.build(store);

const titleAuthorIndex = new SearchIndex({
  fields: [
    { name: 'title', extract: record => { const t = title(record); return t ? [t] : []; } },
    { name: 'author', extract: record => { const a = author(record); return a ? [a] : []; } },
  ],
});
titleAuthorIndex.build(store);
```

Or index any MARC field/tag pattern via a custom `SearchFieldExtractor` — `marc-ts`'s `getFieldsByPattern(record, pattern)` accepts wildcard patterns like `'6..'`, `'7XX'`, or `'X00'`:

```typescript
import { getFieldsByPattern, isDataField } from 'marc-ts';

const isbnIndex = new SearchIndex({
  fields: [{ name: 'isbn', extract: record => isbn(record) }],
});
isbnIndex.build(store);
```

### `SearchIndexOptions`

```typescript
interface SearchIndexOptions {
  fields?: SearchFieldExtractor[];    // defaults to DEFAULT_SEARCH_FIELDS
  boost?: Record<string, number>;     // per-field relevance boost
  fuzzy?: number | boolean;           // default 0.2
  prefix?: boolean;                   // default true
  tokenize?: (text: string, fieldName?: string) => string[];
  processTerm?: (term: string, fieldName?: string) => string | string[] | null | undefined | false;
}
```

`tokenize`/`processTerm` are passed straight through to MiniSearch's constructor, for catalogs where the default tokenizer doesn't handle ISBD punctuation or diacritics the way you want.

### Known limitations

- **Synchronous and blocking.** `build()`/`rebuild()` run on the calling thread; indexing very large stores (100K+ records) will take a visible amount of time and will block the browser main thread if called there. There's no Worker-based indexing built in.
- **No live sync.** `add(position, record)`/`remove(position)` exist on `SearchIndex` for building a live-sync wrapper around `EditableStore` yourself, but `marc-store-ts` doesn't ship one — `rebuild()` after a batch of edits is the supported pattern.

## Transform Utilities

`marc-store-ts` includes a set of bulk editing and export functions via the `transform` module. All functions operate on the store's live edit layer — edits made with `setRecord` are visible to them immediately.

### Handling records that fail to parse

By default, a record that cannot be parsed makes the whole operation throw. Every bulk-edit and export function (and `SearchIndex.build`) takes an `onError` option to change that:

| `onError` | Behaviour |
|---|---|
| `'throw'` (default) | Stop and rethrow the parse error |
| `'skip'` | Leave the record out and carry on |
| `(position, error) => void` | Call the function, then skip the record |

Skipped records are left untouched in the store: `applyToAll`/`applyToMatching` don't modify them, and `deleteMatching`/`keepMatching` keep them. `toMarcXml`/`toJson` omit them. `toMarcBinary` doesn't parse unmodified UTF-8 records, so it writes them unchanged whatever the option; it only parses (and applies `onError` to) records it is converting from MARC-8, and with `encoding: 'preserve'` it parses nothing.

```typescript
const failures: number[] = [];
applyToAll(store, addNote, { onError: (position) => failures.push(position) });
writeFileSync('output.xml', toMarcXml(store, { onError: 'skip' }));
```

To inspect every record's status yourself, `iterateRecordResults(store)` yields `{ index, result }` with a `RecordResult` for each position.

### Bulk editing

#### `applyToAll(store, fn)`

Apply a transform to every record in the store. Returns the number of records processed.

```typescript
import { readFileSync } from 'fs';
import { MarcFile, applyToAll, toMarcBinary } from 'marc-store-ts';
import { appendField } from 'marc-ts';
import { writeFileSync } from 'fs';

const store = MarcFile.fromBuffer(readFileSync('catalog.mrc'));

// Add a local note to every record
const count = applyToAll(store, record =>
  appendField(record, {
    tag: '599',
    indicator1: ' ',
    indicator2: ' ',
    subfields: [{ code: 'a', value: 'Migrated 2024' }],
  })
);

console.log(`Updated ${count} records`);
writeFileSync('catalog-updated.mrc', toMarcBinary(store));
```

#### `applyToMatching(store, predicate, fn)`

Apply a transform only to records matching a predicate. Returns the number of records changed.

```typescript
import { applyToMatching } from 'marc-store-ts';
import { getField, isDataField, removeFields, appendField } from 'marc-ts';

// Replace a publisher name in records that have a 264 field
applyToMatching(
  store,
  record => {
    const f = getField(record, '264');
    return f !== undefined && isDataField(f);
  },
  record => {
    const updated = removeFields(record, '264');
    return appendField(updated, {
      tag: '264',
      indicator1: ' ',
      indicator2: '1',
      subfields: [
        { code: 'a', value: 'New York' },
        { code: 'b', value: 'Acme Publishing' },
        { code: 'c', value: '2024' },
      ],
    });
  }
);
```

#### `deleteMatching(store, predicate)`

Delete every record for which the predicate returns `true`. Returns the number of records deleted.

```typescript
import { deleteMatching, toMarcBinary } from 'marc-store-ts';
import { getField, isDataField } from 'marc-ts';
import { writeFileSync } from 'fs';

// Delete all records whose record type (leader byte 6) is 'u' (unknown)
const deleted = deleteMatching(store, record => record.leader[6] === 'u');
console.log(`Deleted ${deleted} records; ${store.totalRecords} remaining`);

writeFileSync('output.mrc', toMarcBinary(store));
```

#### `keepMatching(store, predicate)`

Delete every record for which the predicate returns `false`, keeping only those where it returns `true`. The inverse of `deleteMatching`. Returns the number of records deleted.

```typescript
import { keepMatching, toMarcBinary } from 'marc-store-ts';
import { subjects } from 'marc-ts';
import { writeFileSync } from 'fs';

// Keep only records that have at least one subject heading
const deleted = keepMatching(store, record => subjects(record).length > 0);
console.log(`Removed ${deleted} records; ${store.totalRecords} remaining`);

writeFileSync('filtered.mrc', toMarcBinary(store));
```

### Exporting to files

All export functions return a value — you write it to disk yourself.

#### `toMarcBinary(store, options?)` — MARC21 binary (`.mrc`)

```typescript
import { writeFileSync } from 'fs';
import { toMarcBinary } from 'marc-store-ts';

writeFileSync('output.mrc', toMarcBinary(store));
writeFileSync('output.mrc', toMarcBinary(store, { encoding: 'preserve' }));   // keep MARC-8 bytes
```

The output is UTF-8 throughout. Unmodified UTF-8 records are copied straight from the original buffer without parsing, so this is fast even for large files. Records that were MARC-8 in the source file are parsed and rewritten as UTF-8; see [Character encoding](#character-encoding).

| Option | Default | |
|---|---|---|
| `encoding` | `'utf8'` | `'utf8'` converts MARC-8 records; `'preserve'` writes every unmodified record's original bytes |
| `onError` | `'throw'` | What to do with a MARC-8 record that fails to parse during conversion (`'preserve'` never parses) |

#### `toMarcXml(store, options?)` — MARCXML (`.xml`)

```typescript
import { writeFileSync } from 'fs';
import { toMarcXml } from 'marc-store-ts';

writeFileSync('output.xml', toMarcXml(store));
```

Output follows the [Library of Congress MARCXML schema](https://www.loc.gov/standards/marcxml/) and is always UTF-8. Special characters in field data and attributes (`&`, `<`, `>`, `"`, `'`) are escaped. Records that were MARC-8 in the source file are written as Unicode with leader/09 set to `a` (see [Character encoding](#character-encoding)).

#### `toJson(store, options?)` — JSON (`.json`)

```typescript
import { writeFileSync } from 'fs';
import { toJson } from 'marc-store-ts';

writeFileSync('output.json', toJson(store));                       // MARC-in-JSON, compact
writeFileSync('output.json', toJson(store, { pretty: true }));     // indented
writeFileSync('output.ndjson', toJson(store, { ndjson: true }));   // one record per line
```

| Option | Default | |
|---|---|---|
| `format` | `'marc-in-json'` | `'marc-in-json'` or `'simple'` (below) |
| `pretty` | `false` | Indent with 2 spaces (ignored with `ndjson`) |
| `ndjson` | `false` | Newline-delimited JSON: one record per line, no enclosing array |
| `onError` | `'throw'` | See [Handling records that fail to parse](#handling-records-that-fail-to-parse) |

By default each record is written in the community-standard [MARC-in-JSON](https://rossfsinger.com/blog/2010/09/a-proposal-to-serialize-marc-in-json/) format, which other MARC tools (and `parseMarcJson` in `marc-ts/json`) can read:

```json
{
  "leader": "00000nam a2200000   4500",
  "fields": [
    { "001": "ocm12345678" },
    { "245": { "ind1": "1", "ind2": "0", "subfields": [{ "a": "The Catcher in the Rye" }] } }
  ]
}
```

`format: 'simple'` writes the more explicit shape used before 0.2.0:

```json
{
  "leader": "00000nam a2200000   4500",
  "fields": [
    { "tag": "001", "data": "ocm12345678" },
    {
      "tag": "245",
      "indicator1": "1",
      "indicator2": "0",
      "subfields": [{ "code": "a", "value": "The Catcher in the Rye" }]
    }
  ]
}
```

#### Streaming large exports

`toMarcXml` and `toJson` build the whole output as one string, which can exceed JavaScript's string length limit for very large files. `iterateMarcXml(store, options?)`, `iterateJson(store, options?)` and `iterateMarcBinary(store, options?)` take the same options as their `to…` counterparts but yield the output in chunks (one per record), so you can stream it to disk:

```typescript
import { createWriteStream } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { iterateMarcBinary, iterateMarcXml, iterateJson } from 'marc-store-ts';

await pipeline(Readable.from(iterateMarcBinary(store)), createWriteStream('output.mrc'));
await pipeline(Readable.from(iterateMarcXml(store)), createWriteStream('output.xml'));
await pipeline(Readable.from(iterateJson(store, { ndjson: true })), createWriteStream('output.ndjson'));
```

Joined, the chunks are exactly what the matching `to…` function returns.

#### Character encoding

MARC records are either MARC-8 (leader/09 is a space) or UTF-8 (leader/09 is `a`). `marc-ts` converts MARC-8 text to Unicode when it parses a record, so every record you read from the store holds Unicode strings. Accented characters from MARC-8 come out decomposed (a base letter followed by a combining accent, Unicode NFD); call `.normalize('NFC')` if you need composed characters.

The XML and JSON exports are always Unicode, so they set leader/09 to `a` for records that were MARC-8 in the source file.

`toMarcBinary` also writes UTF-8 by default: unmodified MARC-8 records are parsed and re-serialized as UTF-8, so a file never mixes encodings. Edited and inserted records are always written as UTF-8. Pass `encoding: 'preserve'` to keep unmodified records' original bytes instead (faster, and byte-for-byte, but MARC-8 records stay MARC-8). `store.iterateSerializedRecords()` always yields the original bytes and never converts.

### Putting it together

A complete workflow — load, filter, edit, and export to multiple formats:

```typescript
import { readFileSync, writeFileSync } from 'fs';
import { MarcFile, applyToAll, keepMatching, toMarcBinary, toMarcXml, toJson } from 'marc-store-ts';
import { appendField, subjects } from 'marc-ts';

const store = MarcFile.fromBuffer(readFileSync('catalog.mrc'));

// 1. Keep only records with subject headings
keepMatching(store, record => subjects(record).length > 0);
console.log(`${store.totalRecords} records after filter`);

// 2. Add a processing note to every remaining record
applyToAll(store, record =>
  appendField(record, {
    tag: '583',
    indicator1: ' ',
    indicator2: ' ',
    subfields: [{ code: 'a', value: 'processed' }, { code: 'c', value: '20240101' }],
  })
);

// 3. Write all three output formats
writeFileSync('output.mrc', toMarcBinary(store));
writeFileSync('output.xml', toMarcXml(store));
writeFileSync('output.json', toJson(store, { pretty: true }));
```

## Usage Examples

See the [`examples/`](./examples) directory for detailed examples:

- [**01-basic-usage.ts**](./examples/01-basic-usage.ts) - Loading and reading records
- [**02-editing-records.ts**](./examples/02-editing-records.ts) - Modifying and reverting records
- [**03-serialization.ts**](./examples/03-serialization.ts) - Saving modified files
- [**04-safe-error-handling.ts**](./examples/04-safe-error-handling.ts) - Using result types
- [**05-large-files.ts**](./examples/05-large-files.ts) - Performance optimization tips
- [**06-full-text-search.ts**](./examples/06-full-text-search.ts) - Building and querying a SearchIndex

### Common Patterns

#### Editing a single record

```typescript
import { appendField } from 'marc-ts';

const record = store.getRecord(5);
const modified = appendField(record, {
  tag: '500',
  indicator1: ' ',
  indicator2: ' ',
  subfields: [{ code: 'a', value: 'Additional note' }]
});
store.setRecord(5, modified);
```

#### Safe batch processing

```typescript
import { iterateRecordResults } from 'marc-store-ts';

for (const { index, result } of iterateRecordResults(store)) {
  if (result.ok) {
    // process result.record
  } else {
    console.error(`Record ${index}: ${result.error}`);
  }
}
```

#### Checking modifications

```typescript
console.log(`Modified ${store.modifiedCount} of ${store.totalRecords} records`);

for (let i = 0; i < store.totalRecords; i++) {
  if (store.isModified(i)) {
    console.log(`Record ${i} has been edited`);
  }
}
```

## Performance Characteristics

| Operation | Cost | Notes |
|-----------|------|-------|
| Indexing | O(n), no parsing | Reads only the 5-byte length of each record |
| Cache hit | O(1) | Record already in LRU cache |
| Cache miss | One record parse | Parsed from the buffer on first access |
| Serialization (unmodified) | Zero-copy | Yields a view into the original buffer |
| Serialization (modified) | One record serialize | Re-serializes edited/inserted records only |

### Benchmarks

Measured with `npm run bench` on an Apple M2, Node 26, over synthetic records of about 200 bytes each (10K records ≈ 2 MB, 250K ≈ 51 MB). Each operation runs on a fresh store. Your numbers will vary with record size and hardware; run `npm run bench -- 10000,100000` to measure your own.

| Operation | 10,000 records | 100,000 records | 250,000 records |
|---|---:|---:|---:|
| Index (scanBuffer) | 2.7 ms | 27.6 ms | 70.5 ms |
| Read all records, cold (parse) | 43.2 ms | 389.2 ms | 876.9 ms |
| Cache hit (per read) | 40 ns | 55 ns | 81 ns |
| applyToAll (add a field to every record) | 50.7 ms | 500.1 ms | 1.25 s |
| deleteMatching (half the records) | 41.8 ms | 360.0 ms | 914.6 ms |
| 1000 single deletes, each followed by a read | 38.7 ms | 386.8 ms | 1.14 s |
| 1000 single inserts, each followed by a read | 49.4 ms | 476.7 ms | 1.19 s |
| toMarcBinary (unmodified) | 1.4 ms | 8.2 ms | 30.2 ms |
| toMarcBinary (every record modified) | 58.3 ms | 513.4 ms | 1.25 s |
| toMarcXml | 96.8 ms | 881.6 ms | 2.44 s |
| SearchIndex.build | 114.4 ms | 1.18 s | 3.23 s |

Single inserts and deletes each cost time proportional to the file size, because positions are renumbered; use `deleteRecords` / `insertRecords` (or `deleteMatching`) for batches.

### Memory Usage

- **Index**: ~16 bytes per record (100K records ≈ 1.6MB)
- **Cache**: Size of cached records only (configurable)
- **Edits**: Size of modified/inserted records only (sparse)

### Optimization Tips

1. **Tune cache capacity** based on your access patterns:
   - Sequential access: Small cache (50-100) is sufficient
   - Random access: Larger cache (500-1000) improves performance
   - Default (200) works well for most cases

2. **Use `tryGetRecord()`** for batch processing to avoid exceptions

3. **Stream serialization** instead of loading all chunks into memory:
   ```typescript
   const stream = createWriteStream('output.mrc');
   for (const chunk of store.iterateSerializedRecords()) {
     stream.write(chunk);
   }
   stream.end();
   ```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run tests in watch mode
npx vitest --watch

# Generate coverage report
npm run test:coverage

# Lint
npm run lint

# Type check (library and examples)
npm run type-check

# Run every example against generated sample data (requires a build)
npm run build && npm run examples
```

### Scripts

- `build` - Compile TypeScript to JavaScript (ESM)
- `test` - Run Vitest (watch mode in a terminal, single run in CI)
- `test:coverage` - Generate code coverage report
- `lint` / `lint:fix` - Lint `src/` and `examples/` with ESLint
- `format` / `format:check` - Format `src/` and `examples/` with Prettier
- `type-check` - Type-check the library and the examples without emitting files
- `examples` - Generate sample data and run every example against it

## Requirements

- Node.js 22+
- TypeScript 5.0+ (if using in TypeScript projects)

## License

[MIT](./LICENSE)

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## Related Projects

- [marc-ts](https://github.com/jamesrf/marc-ts) - TypeScript MARC parsing and serialization library
