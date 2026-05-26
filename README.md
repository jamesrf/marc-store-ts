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
- **High Performance**: < 0.1ms cache hits, < 10ms cache misses, < 100ms indexing per 1000 records

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
import { indexBuffer, RecordStore } from 'marc-store-ts';

// Load MARC file
const buffer = readFileSync('catalog.mrc').buffer;

// Index the buffer (find record boundaries)
const index = indexBuffer(buffer);

// Create store with LRU cache (capacity: 200 records)
const store = new RecordStore(buffer, index, 200);

// Access records
const record = store.getRecord(0);
console.log(`Total records: ${store.totalRecords}`);
```

## Architecture

The library uses a **4-layer architecture** for efficient record management:

```
Layer 1: rawBuffer (immutable ArrayBuffer - entire MARC file)
           ↓
Layer 2: recordIndex (lightweight array of record positions/sizes)
           ↓
Layer 3: cache (LRU cache of recently accessed parsed records)
           ↓
Layer 4: overlay (sparse map of edited records - copy-on-write)
```

**Record Retrieval Priority**: overlay → cache → parse from buffer

This design ensures:
- Original file data is never modified (immutable buffer)
- Only recently used records consume memory
- Edits are tracked separately without duplicating unmodified data
- Serialization can reuse original buffer data for unmodified records

## API Documentation

### RecordStore

The main storage engine for MARC files.

#### Constructor

```typescript
constructor(
  rawBuffer: ArrayBuffer,
  recordIndex: RecordIndex[],
  cacheCapacity = 200
)
```

**Parameters:**
- `rawBuffer`: The complete MARC file as an ArrayBuffer
- `recordIndex`: Array of record positions (use `indexBuffer()` to generate)
- `cacheCapacity`: Maximum number of records to keep in LRU cache (default: 200)

#### Properties

```typescript
totalRecords: number           // Total number of records in the file
modifiedCount: number          // Number of edited records
overlay: ReadonlyMap<number, MarcRecord>  // Read-only view of modified records
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

Updates a record. Changes are stored in the overlay (copy-on-write).

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

Reverts a modified record back to its original state.

```typescript
store.revertRecord(0);
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

### indexBuffer()

Scans a MARC file buffer and builds a lightweight index of record boundaries.

```typescript
function indexBuffer(buffer: ArrayBufferLike): RecordIndex[]
```

**Parameters:**
- `buffer`: The MARC file as an ArrayBuffer or similar

**Returns:** Array of `{ offset: number; length: number }` for each record

**Error Handling:**
- Emits warnings (console.warn) for malformed data
- Returns partial index on errors (doesn't throw)
- Handles truncated records, invalid lengths, and overflow gracefully

```typescript
const index = indexBuffer(buffer);
console.log(`Indexed ${index.length} records`);
```

### RecordIndex

Interface representing the position and size of a MARC record:

```typescript
interface RecordIndex {
  offset: number;  // Byte position where record starts
  length: number;  // Record length in bytes
}
```

### LRUCache<K, V>

Generic Least-Recently-Used cache implementation (also exported for general use).

```typescript
class LRUCache<K, V> {
  constructor(capacity: number)

  get(key: K): V | undefined        // Moves accessed entry to end
  set(key: K, value: V): void       // Updates and moves to end; evicts on overflow
  delete(key: K): boolean
  has(key: K): boolean              // Does NOT affect recency
  clear(): void
  get size(): number
}
```

## Transform Utilities

`marc-store-ts` includes a set of bulk editing and export functions via the `transform` module. All functions operate on the store's live overlay — edits made with `setRecord` are visible to them immediately.

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

| Operation | Time | Notes |
|-----------|------|-------|
| Index 1000 records | < 100ms | Scales linearly (extrapolates to ~10s for 100K records) |
| Cache hit | < 0.1ms | Record already in LRU cache |
| Cache miss | < 10ms | Parse from buffer on first access |
| Serialization (unmodified) | ~0ms per record | Zero-copy: yields buffer view |
| Serialization (modified) | < 10ms per record | Re-serializes edited records |

### Memory Usage

- **Index**: ~16 bytes per record (100K records ≈ 1.6MB)
- **Cache**: Size of cached records only (configurable)
- **Overlay**: Size of modified records only (sparse)

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
npm run test:watch

# Generate coverage report
npm run test:coverage

# Lint
npm run lint

# Type check
npm run type-check
```

### Scripts

- `build` - Compile TypeScript to JavaScript (ESM)
- `test` - Run tests once with Vitest
- `test:watch` - Run tests in watch mode
- `test:coverage` - Generate code coverage report
- `lint` - Lint source code with ESLint
- `type-check` - Type checking without emitting files

## Requirements

- Node.js 18+ (for native ESM support)
- TypeScript 5.0+ (if using in TypeScript projects)

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## Related Projects

- [marc-ts](https://github.com/thisismarcio/marc-ts) - TypeScript MARC parsing and serialization library
