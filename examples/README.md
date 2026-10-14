# marc-store-ts Examples

This directory contains practical examples demonstrating how to use `marc-store-ts` for various use cases.

## Prerequisites

- **Node.js 22+** (the examples are TypeScript and run directly with Node's type stripping)
- A MARC21 file to work with: either generate one (below) or use your own

## Getting Sample MARC Data

### Option 1: Generate synthetic data

[`generate-sample-data.ts`](./generate-sample-data.ts) writes a file of synthetic records with titles, authors, ISBNs and subjects:

```bash
node --experimental-strip-types examples/generate-sample-data.ts sample-data.mrc 500
```

### Option 2: Library of Congress

Download real bibliographic records from the Library of Congress:
- [MARC 21 Sample Records](https://www.loc.gov/cds/downloads/MARC/)

## Running the Examples

The examples import `marc-store-ts` by package name, which resolves to the built `dist/`, so build first:

```bash
git clone https://github.com/jamesrf/marc-store-ts.git
cd marc-store-ts
npm install
npm run build
```

Then run any example, passing the MARC file as the first argument (default: `sample-data.mrc` in the current directory):

```bash
node --experimental-strip-types examples/01-basic-usage.ts sample-data.mrc
```

To generate sample data and run every example in one step:

```bash
npm run examples
```

## Example Descriptions

### [01-basic-usage.ts](./01-basic-usage.ts)

**What it demonstrates:**
- Loading a MARC file from disk
- Indexing the buffer to find record boundaries
- Creating a MarcFile store with default settings
- Accessing records by index
- Displaying basic record information

**Usage:**
```bash
node --experimental-strip-types examples/01-basic-usage.ts [path-to-marc-file]
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
node --experimental-strip-types examples/02-editing-records.ts [path-to-marc-file]
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
node --experimental-strip-types examples/03-serialization.ts [input-file] [output-file]

# Defaults:
node --experimental-strip-types examples/03-serialization.ts sample-data.mrc output.mrc
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
node --experimental-strip-types examples/04-safe-error-handling.ts [path-to-marc-file]
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
node --experimental-strip-types examples/05-large-files.ts [path-to-large-marc-file]
```

**Output:** Performance metrics, memory usage analysis, and optimization recommendations

**Note:** This example is most informative with larger files (10K+ records)

---

### [06-full-text-search.ts](./06-full-text-search.ts)

**What it demonstrates:**
- Building a `SearchIndex` over a store's records
- Querying by title, author, and subject terms
- Keeping the index in sync after edits (rebuild-after-batch pattern)
- Building multiple independent indexes scoped to specific fields
- Customizing which fields are indexed via a custom `SearchFieldExtractor`

**Usage:**
```bash
node --experimental-strip-types examples/06-full-text-search.ts [path-to-marc-file] [search-term] [isbn]

# Defaults:
node --experimental-strip-types examples/06-full-text-search.ts sample-data.mrc history
```

**Output:** Search results for a general query, a field-scoped query, and an ISBN lookup, plus a demonstration of index rebuilding after deleting records

## Example Output Location

- Examples 01, 02, 04, 06: Read-only (no files created)
- Example 03: Creates `output.mrc` (or custom output file)
- Example 05: Creates `output-large.mrc`

## Common Issues

### "Cannot find module 'marc-store-ts'"

Make sure you've built the project first:
```bash
npm run build
```

### "File not found" error

Specify the full path to your MARC file:
```bash
node --experimental-strip-types examples/01-basic-usage.ts /full/path/to/data.mrc
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
   import { MarcFile } from 'marc-store-ts';
   import { /* utilities */ } from 'marc-ts';
   ```

2. **Load and index:**
   ```typescript
   const store = MarcFile.fromBuffer(readFileSync(filePath));
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
