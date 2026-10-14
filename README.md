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

### MarcFile / RecordStore

The main storage engine for MARC files. Exported as both `MarcFile` (primary name) and `RecordStore` (backward-compatibility alias).

#### Static factory

```typescript
static fromBuffer(
  buffer: Uint8Array | ArrayBuffer,
  options?: number | FromBufferOptions
): MarcFile

interface FromBufferOptions {
  cacheCapacity?: number;                  // LRU cache size (default 200)
  recover?: boolean;                       // skip corrupt records instead of stopping (default false)
  onIssue?: (issue: IndexIssue) => void;   // replaces the default console.warn
}
```

Convenience factory — indexes the buffer with [`scanBuffer()`](#scanbuffer) and constructs the store in one call. A plain number is still accepted as the cache capacity.

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
slots: readonly Readonly<RecordSlot>[]     // Read-only snapshot of all record slots (see RecordSlot)
base: MarcBase                             // Advanced: underlying buffer and LRU cache layer
edits: EditLayer                           // Advanced: copy-on-write edit layer
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

Reverts a modified or deleted record back to its original state. Has no effect on inserted records (use `deleteRecord` to remove them instead).

```typescript
store.revertRecord(0);
```

##### deleteRecord(index: number): void

Marks a record as deleted in the edit layer. Deleted records are excluded from `totalRecords` and `iterateRecords()`. Reversible via `revertRecord()`.

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

##### getSerializedRecord(index: number): Uint8Array

Returns the serialized binary representation of a single record. For unmodified records this is a zero-copy view into the original buffer.

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

**Zero-copy optimization**: Unmodified records yield Uint8Array views into the original buffer without re-parsing.

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

Scans a MARC file buffer and builds a lightweight index of record boundaries, returning any problems as data. It reads only each record's 5-byte length (and checks its last byte for the `0x1D` record terminator); record content is not parsed. It never throws and never logs.

```typescript
function scanBuffer(buffer: Uint8Array | ArrayBuffer, options?: ScanOptions): ScanResult

interface ScanOptions {
  recover?: boolean;                      // resync on the next 0x1D instead of stopping (default false)
  onIssue?: (issue: IndexIssue) => void;  // called as each issue is found
}

interface ScanResult {
  index: RecordIndex[];    // records found, in file order
  issues: IndexIssue[];    // empty for a clean file
  bytesConsumed: number;   // less than buffer.length if scanning stopped early
}

interface IndexIssue {
  kind: 'truncated-length' | 'invalid-length' | 'too-short' | 'overflow'
      | 'missing-terminator' | 'skipped';
  offset: number;
  message: string;
}
```

Behaviour:
- Whitespace between records (newlines, spaces, NUL padding), which some exports add, is skipped.
- A record whose last byte is not `0x1D` is still indexed, with a `missing-terminator` issue.
- An invalid length stops the scan, unless `recover` is set, in which case the scanner skips to the byte after the next `0x1D` and continues, reporting a `skipped` issue.

```typescript
const { index, issues } = scanBuffer(buffer, { recover: true });
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

### RecordSlot

Discriminated union representing the state of each record in the edit layer. Accessible via `store.slots`.

```typescript
type RecordSlot =
  | { kind: 'original'; index: number }                      // Unmodified — points to original buffer
  | { kind: 'modified'; index: number; record: MarcRecord }  // Edited in place
  | { kind: 'deleted'; index: number }                       // Marked for deletion
  | { kind: 'inserted'; record: MarcRecord }                 // Newly inserted (no original counterpart)
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

`SearchIndex` does not observe `setRecord`/`deleteRecord`/`insertRecord` automatically — there are no mutation hooks on the edit layer. The supported pattern is to rebuild the index after a batch of edits finishes:

```typescript
import { applyToAll, deleteMatching } from 'marc-store-ts';

deleteMatching(store, record => record.leader[6] === 'u');
applyToAll(store, record => /* ... */ record);

index.rebuild(store); // re-indexes from the store's current state
```

This is a full re-index (`O(totalRecords)`), but it sidesteps a subtlety: record `position` values shift when records are deleted or inserted. Because the index is always rebuilt together with the store, `position` values returned by `search()` are never stale.

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

#### `toMarcBinary(store)` — MARC21 binary (`.mrc`)

```typescript
import { writeFileSync } from 'fs';
import { toMarcBinary } from 'marc-store-ts';

writeFileSync('output.mrc', toMarcBinary(store));
```

Unmodified records are zero-copied from the original buffer, so this is fast even for large files.

#### `toMarcXml(store, options?)` — MARCXML (`.xml`)

```typescript
import { writeFileSync } from 'fs';
import { toMarcXml } from 'marc-store-ts';

writeFileSync('output.xml', toMarcXml(store));

// Custom encoding declaration
writeFileSync('output.xml', toMarcXml(store, { encoding: 'UTF-8' }));
```

Output follows the [Library of Congress MARCXML schema](https://www.loc.gov/standards/marcxml/). Special characters in field data (`&`, `<`, `>`, `"`, `'`) are automatically escaped.

#### `toJson(store, options?)` — JSON (`.json`)

```typescript
import { writeFileSync } from 'fs';
import { toJson } from 'marc-store-ts';

// Compact
writeFileSync('output.json', toJson(store));

// Pretty-printed
writeFileSync('output.json', toJson(store, { pretty: true }));
```

Each record is serialized as:
```json
{
  "leader": "00000nam  2200000   4500",
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
for (let i = 0; i < store.totalRecords; i++) {
  const result = store.tryGetRecord(i);
  if (result.ok) {
    // process result.record
  } else {
    console.error(`Record ${i}: ${result.error}`);
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

Benchmarked timings will be published once a benchmark suite is added.

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
