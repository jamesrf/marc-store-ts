/**
 * Basic Usage Example
 *
 * This example demonstrates:
 * - Loading a MARC file from disk
 * - Indexing the buffer to find record boundaries
 * - Creating a RecordStore
 * - Accessing records by index
 * - Displaying basic record information
 */

import { readFileSync } from 'fs';
import { indexBuffer, MarcFile } from 'marc-store-ts';
import { isControlField, isDataField } from 'marc-ts';

// Load MARC file into memory
const filePath = process.argv[2] || 'sample-data.mrc';
console.log(`Loading MARC file: ${filePath}`);

const buffer = readFileSync(filePath);
console.log(`File size: ${(buffer.byteLength / 1024).toFixed(2)} KB`);

// Index the buffer to find record boundaries
console.log('Indexing buffer...');
const startIndex = Date.now();
const recordIndex = indexBuffer(buffer);
const indexTime = Date.now() - startIndex;
console.log(`Indexed ${recordIndex.length} records in ${indexTime}ms`);

// Create MarcFile with default cache capacity (200 records)
const store = new MarcFile(buffer, recordIndex);
console.log(`\nMarcFile created with ${store.totalRecords} records`);
console.log(`Cache capacity: 200 records`);

// Access first record
console.log('\n--- First Record ---');
const firstRecord = store.getRecord(0);
console.log('Leader:', firstRecord.leader);
console.log('Control fields:');
for (const field of firstRecord.fields.filter(isControlField)) {
  console.log(`  ${field.tag}: ${field.data}`);
}

// Access a few more records to demonstrate caching
console.log('\n--- Accessing Multiple Records ---');
for (let i = 0; i < Math.min(5, store.totalRecords); i++) {
  const start = Date.now();
  const record = store.getRecord(i);
  const time = Date.now() - start;

  const titleField = record.fields.find(f => f.tag === '245');
  const titleValue = (titleField && isDataField(titleField))
    ? (titleField.subfields.find(s => s.code === 'a')?.value ?? 'No title')
    : 'No title';

  console.log(`Record ${i}: "${titleValue.substring(0, 50)}" (${time}ms)`);
}

// Display summary statistics
console.log('\n--- Summary ---');
console.log(`Total records: ${store.totalRecords}`);
console.log(`Modified records: ${store.modifiedCount}`);
console.log(`Index size: ${(recordIndex.length * 16 / 1024).toFixed(2)} KB (approx)`);
