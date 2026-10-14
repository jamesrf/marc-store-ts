/**
 * Full-Text Search Example
 *
 * This example demonstrates:
 * - Building a SearchIndex over a store's records
 * - Querying by title, author, and subject terms
 * - How search results follow inserts and deletes without re-indexing
 * - Building multiple independent indexes scoped to specific fields
 * - Customizing which fields are indexed
 */

import { readFileSync } from 'fs';
import {
  indexBuffer,
  MarcFile,
  SearchIndex,
  DEFAULT_SEARCH_FIELDS,
  deleteMatching,
} from 'marc-store-ts';
import { isbn, isDataField } from 'marc-ts';

// Load and index MARC file
const filePath = process.argv[2] || 'sample-data.mrc';
console.log(`Loading MARC file: ${filePath}`);

const buffer = readFileSync(filePath);
const recordIndex = indexBuffer(buffer);
const store = new MarcFile(buffer, recordIndex);

console.log(`Loaded ${store.totalRecords} records\n`);

function printResults(results: ReturnType<SearchIndex['search']>) {
  if (results.length === 0) {
    console.log('  (no matches)');
    return;
  }
  for (const { position, score } of results.slice(0, 5)) {
    const titleField = store.getRecord(position).fields.find((f) => f.tag === '245');
    const title =
      titleField && isDataField(titleField)
        ? titleField.subfields.find((s) => s.code === 'a')?.value
        : undefined;
    console.log(`  [${position}] score=${score.toFixed(2)}  ${title ?? '(no title)'}`);
  }
  if (results.length > 5) {
    console.log(`  ...and ${results.length - 5} more`);
  }
}

// Example 1: Build a default index over the whole store
console.log('--- Example 1: Building the Default Index ---');
const index = new SearchIndex();
index.build(store);
console.log(
  `Indexed ${index.size} records across fields: ${DEFAULT_SEARCH_FIELDS.map((f) => f.name).join(', ')}`
);

// Example 2: Query by a general term (searches title/author/subjects/contents)
console.log('\n--- Example 2: General Query ---');
const query = process.argv[3] || 'history';
console.log(`Searching for "${query}"...`);
printResults(index.search(query));

// Example 3: Keep the index in sync after a batch of edits
console.log('\n--- Example 3: Search After Edits ---');
console.log('Deleting records whose leader marks them as type "u" (unknown)...');
const deleted = deleteMatching(store, (record) => record.leader[6] === 'u');
console.log(`Deleted ${deleted} record(s); ${store.totalRecords} remain`);

// No rebuild needed for deletions: results follow the store's current
// positions and leave out deleted records. Rebuild after content edits.
console.log(`Search results now cover the ${store.totalRecords} remaining records`);
printResults(index.search(query));

// Example 4: Multiple independent, field-scoped indexes
console.log('\n--- Example 4: Field-Scoped Indexes ---');
console.log('Building a subjects-only index and a title/author-only index over the same store...');

const subjectIndex = new SearchIndex({
  fields: [DEFAULT_SEARCH_FIELDS.find((f) => f.name === 'subjects')!],
});
subjectIndex.build(store);

const titleAuthorIndex = new SearchIndex({
  fields: DEFAULT_SEARCH_FIELDS.filter((f) => f.name === 'title' || f.name === 'author'),
});
titleAuthorIndex.build(store);

console.log(`\nSubject-only search for "${query}":`);
printResults(subjectIndex.search(query));

console.log(`\nTitle/author-only search for "${query}":`);
printResults(titleAuthorIndex.search(query));

// Example 5: Fully custom field extractor (e.g. search by ISBN)
console.log('\n--- Example 5: Custom Field Extractor ---');
console.log('Building an ISBN-only index (020 $a) using a custom SearchFieldExtractor...');

const isbnIndex = new SearchIndex({
  fields: [{ name: 'isbn', extract: (record) => isbn(record) }],
});
isbnIndex.build(store);

const sampleIsbn = process.argv[4];
if (sampleIsbn) {
  console.log(`Searching ISBN index for "${sampleIsbn}"...`);
  printResults(isbnIndex.search(sampleIsbn));
} else {
  console.log('(pass a 4th argument with an ISBN to try this search, e.g. "978-0-...")');
}

console.log('\nFull-text search example complete!');
