# marc-store-ts Examples

This directory contains practical examples demonstrating how to use `marc-store-ts` for various use cases.

## Prerequisites

Before running these examples, you'll need:

1. **Node.js 18+** installed
2. **Sample MARC data files** to work with

## Getting Sample MARC Data

You can obtain sample MARC files from several sources:

### Option 1: Library of Congress
Download sample bibliographic records from the Library of Congress:
- [MARC 21 Sample Records](https://www.loc.gov/cds/downloads/MARC/)

### Option 2: Create Your Own
Use the `marc-ts` library to create sample records programmatically:

```typescript
import { writeFileSync } from 'fs';
import { serializeRecord, MarcRecord } from 'marc-ts';

const sampleRecord: MarcRecord = {
  leader: '00000nam  2200000   4500',
  controlFields: [
    { tag: '001', value: '123456' },
    { tag: '008', value: '240101s2024    xx            000 0 eng d' }
  ],
  dataFields: [
    {
      tag: '245',
      indicator1: '0',
      indicator2: '0',
      subfields: [
        { code: 'a', value: 'Sample Title' },
        { code: 'c', value: 'Sample Author' }
      ]
    }
  ]
};

const serialized = serializeRecord(sampleRecord);
writeFileSync('sample-data.mrc', serialized);
```

### Option 3: Use Test Data
Check the project's test files for sample data generation helpers:
- `src/__tests__/helpers/test-data.ts` contains utility functions for creating test records

## Running the Examples

### Setup

1. Clone the repository and install dependencies:
```bash
git clone <repository-url>
cd marc-store-ts
npm install
npm run build
```

2. Place your sample MARC file in the project root or examples directory:
```bash
cp /path/to/your/data.mrc ./sample-data.mrc
```

### Running Individual Examples

Each example can be run with `ts-node` or compiled and run with Node.js:

#### Using ts-node (recommended for development)

```bash
npm install -g ts-node

# Run with default sample file (sample-data.mrc)
ts-node examples/01-basic-usage.ts

# Run with a specific file
ts-node examples/01-basic-usage.ts /path/to/your/data.mrc
```

#### Using compiled JavaScript

```bash
# Compile the examples
npx tsc examples/*.ts --outDir examples/dist --module es2020 --target es2020 --moduleResolution node

# Run compiled examples
node examples/dist/01-basic-usage.js /path/to/your/data.mrc
```

## Example Descriptions

### [01-basic-usage.ts](./01-basic-usage.ts)

**What it demonstrates:**
- Loading a MARC file from disk
- Indexing the buffer to find record boundaries
- Creating a RecordStore with default settings
- Accessing records by index
- Displaying basic record information

**Usage:**
```bash
ts-node examples/01-basic-usage.ts [path-to-marc-file]
```

**Output:** Summary of the file, record count, and first few record titles

---

### [02-editing-records.ts](./02-editing-records.ts)

**What it demonstrates:**
- Getting records from the store
- Adding new fields to records
- Updating existing fields
- Removing fields
- Checking modification status
- Reverting changes to original state

**Usage:**
```bash
ts-node examples/02-editing-records.ts [path-to-marc-file]
```

**Output:** Step-by-step log of edit operations and modification tracking

---

### [03-serialization.ts](./03-serialization.ts)

**What it demonstrates:**
- Modifying records in the store
- Using `iterateSerializedRecords()` to get output
- Writing the modified file back to disk
- Understanding zero-copy optimization
- Verifying the output file

**Usage:**
```bash
ts-node examples/03-serialization.ts [input-file] [output-file]

# Defaults:
ts-node examples/03-serialization.ts sample-data.mrc output.mrc
```

**Output:** Creates a new MARC file with modifications and verifies it

---

### [04-safe-error-handling.ts](./04-safe-error-handling.ts)

**What it demonstrates:**
- Using `tryGetRecord()` instead of `getRecord()`
- Handling result types with discriminated unions
- Processing records without exceptions
- Batch processing with error tracking
- Type-safe error handling patterns

**Usage:**
```bash
ts-node examples/04-safe-error-handling.ts [path-to-marc-file]
```

**Output:** Demonstrates safe error handling in various scenarios

---

### [05-large-files.ts](./05-large-files.ts)

**What it demonstrates:**
- Best practices for files with 50K-250K records
- Tuning cache capacity for different access patterns
- Sequential vs. random access strategies
- Memory-efficient editing
- Streaming serialization
- Performance benchmarks

**Usage:**
```bash
ts-node examples/05-large-files.ts [path-to-large-marc-file]
```

**Output:** Performance metrics, memory usage analysis, and optimization recommendations

**Note:** This example is most informative with larger files (10K+ records)

## Example Output Location

- Examples 01, 02, 04, 05: Read-only (no files created)
- Example 03: Creates `output.mrc` (or custom output file)
- Example 05: Creates `output-large.mrc`

## Common Issues

### "Cannot find module 'marc-store-ts'"

Make sure you've built the project first:
```bash
npm run build
```

Alternatively, use `ts-node` with the `--project` flag:
```bash
ts-node --project tsconfig.json examples/01-basic-usage.ts
```

### "File not found" error

Specify the full path to your MARC file:
```bash
ts-node examples/01-basic-usage.ts /full/path/to/data.mrc
```

### TypeScript errors

Ensure you're using TypeScript 5.0+:
```bash
npx tsc --version
npm install -D typescript@latest
```

## Creating Your Own Examples

Feel free to create your own examples based on these templates. Key patterns to follow:

1. **Import the library:**
   ```typescript
   import { indexBuffer, RecordStore } from 'marc-store-ts';
   import { /* utilities */ } from 'marc-ts';
   ```

2. **Load and index:**
   ```typescript
   const buffer = new Uint8Array(readFileSync(filePath)).buffer;
   const index = indexBuffer(buffer);
   const store = new RecordStore(buffer, index);
   ```

3. **Use try/catch or tryGetRecord():**
   ```typescript
   const result = store.tryGetRecord(i);
   if (result.ok) {
     // Process result.record
   }
   ```

4. **Clean up:**
   Always close file streams and handle errors gracefully.

## Additional Resources

- [Main README](../README.md) - Full API documentation
- [API Tests](../src/__tests__/) - More usage examples
- [marc-ts documentation](https://github.com/thisismarcio/marc-ts) - MARC parsing utilities

## Contributing

Found a bug in an example or have a suggestion? Please open an issue or submit a pull request!
