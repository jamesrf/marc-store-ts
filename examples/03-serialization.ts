/**
 * Serialization Example
 *
 * This example demonstrates:
 * - Loading and modifying records
 * - Using iterateSerializedRecords() to get serialized output
 * - Writing modified file back to disk
 * - Understanding zero-copy optimization
 */

import { readFileSync, writeFileSync } from 'fs';
import { indexBuffer, MarcFile } from 'marc-store-ts';
import { appendField, isDataField } from 'marc-ts';

// Load and index MARC file
const inputFile = process.argv[2] || 'sample-data.mrc';
const outputFile = process.argv[3] || 'output.mrc';

console.log(`Loading MARC file: ${inputFile}`);
const buffer = readFileSync(inputFile);
const recordIndex = indexBuffer(buffer);
const store = new MarcFile(buffer, recordIndex);

console.log(`Loaded ${store.totalRecords} records\n`);

// Make some modifications to demonstrate serialization
console.log('--- Making Modifications ---');

// Modify every 10th record (or first 3, whichever is less)
const modifyCount = Math.min(3, Math.ceil(store.totalRecords / 10));
for (let i = 0; i < modifyCount; i++) {
  const recordPos = i * 10;
  if (recordPos < store.totalRecords) {
    const record = store.getRecord(recordPos);

    const modified = appendField(record, {
      tag: '500',
      indicator1: ' ',
      indicator2: ' ',
      subfields: [
        { code: 'a', value: `Modified in serialization example at ${new Date().toISOString()}` },
      ],
    });

    store.setRecord(recordPos, modified);
    console.log(`Modified record ${recordPos}`);
  }
}

console.log(`\nTotal modified records: ${store.modifiedCount}`);

// Serialize all records
console.log('\n--- Serializing Records ---');
console.log('Collecting serialized chunks...');

const startTime = Date.now();
const chunks: Uint8Array[] = [];

for (const chunk of store.iterateSerializedRecords()) {
  chunks.push(chunk);
}

const serializeTime = Date.now() - startTime;
console.log(`Serialized ${chunks.length} records in ${serializeTime}ms`);

// Explain zero-copy optimization
console.log('\nZero-Copy Optimization:');
console.log(`- ${store.modifiedCount} records were re-serialized (modified)`);
console.log(`- ${store.totalRecords - store.modifiedCount} records used zero-copy (unmodified)`);
console.log('  Zero-copy records are returned as Uint8Array views into the original buffer');

// Concatenate chunks into a single buffer
console.log('\n--- Creating Output File ---');
const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
const output = new Uint8Array(totalLength);

let offset = 0;
for (const chunk of chunks) {
  output.set(chunk, offset);
  offset += chunk.length;
}

// Write to file
writeFileSync(outputFile, output);
console.log(`Wrote ${output.length} bytes to ${outputFile}`);
console.log(`Original size: ${buffer.byteLength} bytes`);
console.log(`New size: ${output.length} bytes`);

// Verify the output by re-loading it
console.log('\n--- Verification ---');
const verifyBuffer = readFileSync(outputFile);
const verifyIndex = indexBuffer(verifyBuffer);
console.log(`Output file contains ${verifyIndex.length} records`);

if (verifyIndex.length === store.totalRecords) {
  console.log('✓ Record count matches!');
} else {
  console.log('✗ Record count mismatch!');
}

// Check that modifications are preserved
const verifyStore = new MarcFile(verifyBuffer, verifyIndex);
for (let i = 0; i < store.totalRecords; i++) {
  if (store.isModified(i)) {
    const verified = verifyStore.getRecord(i);

    // Check if the modification is present (look for our added 500 field)
    const has500 = verified.fields.some(
      (f) =>
        f.tag === '500' &&
        isDataField(f) &&
        f.subfields.some((s) => s.value.includes('serialization example'))
    );

    if (has500) {
      console.log(`✓ Record ${i}: Modification preserved`);
    } else {
      console.log(`✗ Record ${i}: Modification lost`);
    }
  }
}

console.log('\nSerialization complete!');
