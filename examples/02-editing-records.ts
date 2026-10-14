/**
 * Editing Records Example
 *
 * This example demonstrates:
 * - Loading and indexing a MARC file
 * - Getting a record
 * - Modifying records using marc-ts utilities
 * - Using setRecord to save changes
 * - Checking modification status
 * - Reverting changes
 */

import { readFileSync } from 'fs';
import { indexBuffer, MarcFile } from 'marc-store-ts';
import { appendField, removeField, getField, isDataField } from 'marc-ts';

// Load and index MARC file
const filePath = process.argv[2] || 'sample-data.mrc';
console.log(`Loading MARC file: ${filePath}`);

const buffer = readFileSync(filePath);
const recordIndex = indexBuffer(buffer);
const store = new MarcFile(buffer, recordIndex);

console.log(`Loaded ${store.totalRecords} records\n`);

// Example 1: Add a note field to record 0
console.log('--- Example 1: Adding a Field ---');
const record0 = store.getRecord(0);
console.log(`Original field count: ${record0.fields.length}`);

const withNote = appendField(record0, {
  tag: '500',
  indicator1: ' ',
  indicator2: ' ',
  subfields: [{ code: 'a', value: 'This record has been modified by marc-store-ts example.' }],
});

store.setRecord(0, withNote);
console.log(`Modified field count: ${store.getRecord(0).fields.length}`);
console.log(`Store now has ${store.modifiedCount} modified record(s)`);

// Example 2: Update an existing field in record 1 (if it exists)
if (store.totalRecords > 1) {
  console.log('\n--- Example 2: Updating a Field ---');
  const record1 = store.getRecord(1);

  // Find first 500 field (note)
  const note1 = getField(record1, '500');

  if (note1 && isDataField(note1)) {
    const without = removeField(record1, note1);
    const updated = appendField(without, {
      tag: '500',
      indicator1: ' ',
      indicator2: ' ',
      subfields: [{ code: 'a', value: 'Updated note field.' }],
    });

    store.setRecord(1, updated);
    console.log(`Updated field 500 in record 1`);
    console.log(`Store now has ${store.modifiedCount} modified record(s)`);
  } else {
    console.log('No 500 field found in record 1 to update');
  }
}

// Example 3: Remove a field from record 2 (if it exists)
if (store.totalRecords > 2) {
  console.log('\n--- Example 3: Removing a Field ---');
  const record2 = store.getRecord(2);

  // Find first 500 field to remove
  const note2 = getField(record2, '500');

  if (note2 && isDataField(note2)) {
    const withoutNote = removeField(record2, note2);
    store.setRecord(2, withoutNote);
    console.log(`Removed field 500 from record 2`);
    console.log(`Store now has ${store.modifiedCount} modified record(s)`);
  } else {
    console.log('No 500 field found in record 2 to remove');
  }
}

// Check modification status
console.log('\n--- Modification Status ---');
console.log(`Total modified records: ${store.modifiedCount}`);
for (let i = 0; i < Math.min(5, store.totalRecords); i++) {
  if (store.isModified(i)) {
    console.log(`  Record ${i}: MODIFIED`);
  }
}

// Example 4: Revert a change
console.log('\n--- Example 4: Reverting Changes ---');
console.log(`Before revert: ${store.modifiedCount} modified record(s)`);
console.log(`Record 0 is modified: ${store.isModified(0)}`);

store.revertRecord(0);

console.log(`After revert: ${store.modifiedCount} modified record(s)`);
console.log(`Record 0 is modified: ${store.isModified(0)}`);

// Summary
console.log('\n--- Summary ---');
console.log(`Total records: ${store.totalRecords}`);
console.log(`Currently modified: ${store.modifiedCount}`);
console.log(`\nModified record indices:`);
for (let i = 0; i < store.totalRecords; i++) {
  if (store.isModified(i)) {
    console.log(`  - Record ${i}`);
  }
}
