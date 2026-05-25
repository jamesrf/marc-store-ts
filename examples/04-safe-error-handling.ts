/**
 * Safe Error Handling Example
 *
 * This example demonstrates:
 * - Using tryGetRecord() instead of getRecord()
 * - Handling result types with discriminated unions
 * - Processing records gracefully without exceptions
 * - Handling malformed or missing records
 */

import { readFileSync } from 'fs';
import { indexBuffer, RecordStore } from 'marc-store-ts';

// Load and index MARC file
const filePath = process.argv[2] || 'sample-data.mrc';
console.log(`Loading MARC file: ${filePath}`);

const buffer = readFileSync(filePath).buffer;
const recordIndex = indexBuffer(buffer);
const store = new RecordStore(buffer, recordIndex);

console.log(`Loaded ${store.totalRecords} records\n`);

// Example 1: Safe access with tryGetRecord()
console.log('--- Example 1: Safe Record Access ---');

const result = store.tryGetRecord(0);
if (result.ok) {
  console.log('✓ Successfully retrieved record 0');
  console.log(`  Leader: ${result.record.leader}`);
  console.log(`  Fields: ${result.record.dataFields.length}`);
} else {
  console.log('✗ Failed to retrieve record 0');
  console.log(`  Error: ${result.error}`);
}

// Example 2: Accessing out-of-bounds record
console.log('\n--- Example 2: Out-of-Bounds Access ---');

const invalidIndex = store.totalRecords + 100;
console.log(`Attempting to access record ${invalidIndex} (out of bounds)...`);

const outOfBounds = store.tryGetRecord(invalidIndex);
if (outOfBounds.ok) {
  console.log('✓ Retrieved record (unexpected)');
} else {
  console.log('✗ Failed as expected');
  console.log(`  Error: ${outOfBounds.error}`);
}

// Example 3: Batch processing with error handling
console.log('\n--- Example 3: Batch Processing with Error Handling ---');

let successCount = 0;
let errorCount = 0;
const errors: { index: number; error: string }[] = [];

// Process all records (or first 100 for large files)
const recordsToProcess = Math.min(100, store.totalRecords);
console.log(`Processing ${recordsToProcess} records...`);

for (let i = 0; i < recordsToProcess; i++) {
  const result = store.tryGetRecord(i);

  if (result.ok) {
    successCount++;
    // Process the record here
    // Example: extract title
    const title = result.record.dataFields.find(f => f.tag === '245');
    if (!title) {
      // Could track records without titles if needed
    }
  } else {
    errorCount++;
    errors.push({ index: i, error: result.error });
  }
}

console.log(`\nResults:`);
console.log(`  Success: ${successCount} records`);
console.log(`  Errors: ${errorCount} records`);

if (errors.length > 0) {
  console.log('\nError details:');
  errors.slice(0, 5).forEach(({ index, error }) => {
    console.log(`  Record ${index}: ${error}`);
  });
  if (errors.length > 5) {
    console.log(`  ... and ${errors.length - 5} more errors`);
  }
}

// Example 4: Comparison with getRecord() (throwing version)
console.log('\n--- Example 4: Comparison with getRecord() ---');

console.log('Using getRecord() (may throw):');
try {
  const record = store.getRecord(0);
  console.log('✓ Record 0 retrieved successfully');
} catch (error) {
  console.log(`✗ Exception caught: ${error}`);
}

console.log('\nTrying to access invalid record with getRecord():');
try {
  const record = store.getRecord(store.totalRecords + 100);
  console.log('✓ Record retrieved (unexpected)');
} catch (error) {
  console.log(`✗ Exception caught: ${error instanceof Error ? error.message : error}`);
}

// Example 5: Type-safe error handling pattern
console.log('\n--- Example 5: Type-Safe Processing Function ---');

function processRecord(store: RecordStore, index: number): string {
  const result = store.tryGetRecord(index);

  if (!result.ok) {
    return `Error: ${result.error}`;
  }

  // TypeScript knows result.record exists here
  const title = result.record.dataFields
    .find(f => f.tag === '245')
    ?.subfields
    .find(s => s.code === 'a')
    ?.value || 'No title';

  return `Title: ${title}`;
}

// Use the type-safe function
for (let i = 0; i < Math.min(3, store.totalRecords); i++) {
  console.log(`Record ${i}: ${processRecord(store, i)}`);
}

// Summary
console.log('\n--- Summary ---');
console.log('Benefits of tryGetRecord():');
console.log('  ✓ No exceptions to catch');
console.log('  ✓ Type-safe error handling');
console.log('  ✓ Explicit success/failure states');
console.log('  ✓ Better for batch processing');
console.log('\nWhen to use getRecord():');
console.log('  - When you know the index is valid');
console.log('  - In contexts where exceptions are acceptable');
console.log('  - When you want to fail fast');
