/**
 * Large Files and Performance Example
 *
 * This example demonstrates:
 * - Best practices for very large MARC files (50K-250K records)
 * - Tuning cache capacity based on access patterns
 * - Memory management strategies
 * - Performance optimization techniques
 * - Streaming serialization for large outputs
 */

import { readFileSync, createWriteStream } from 'fs';
import { indexBuffer, MarcFile } from 'marc-store-ts';

// Load and index MARC file
const filePath = process.argv[2] || 'sample-data.mrc';
console.log(`Loading large MARC file: ${filePath}`);

const buffer = readFileSync(filePath);
const fileSizeMB = (buffer.byteLength / 1024 / 1024).toFixed(2);
console.log(`File size: ${fileSizeMB} MB`);

// Benchmark indexing
console.log('\n--- Indexing Performance ---');
const indexStart = Date.now();
const recordIndex = indexBuffer(buffer);
const indexTime = Date.now() - indexStart;

console.log(`Indexed ${recordIndex.length} records in ${indexTime}ms`);
console.log(`Average: ${(indexTime / recordIndex.length).toFixed(3)}ms per record`);
console.log(`Index memory: ~${(recordIndex.length * 16 / 1024).toFixed(2)} KB`);

// Strategy 1: Sequential access with small cache
console.log('\n--- Strategy 1: Sequential Access (Small Cache) ---');
console.log('Use case: Processing records in order (e.g., batch export)');
console.log('Optimal cache size: 50-100 records');

const sequentialStore = new MarcFile(buffer, recordIndex, 50);
console.log(`Created store with cache capacity: 50`);

// Simulate sequential access
const seqStart = Date.now();
let seqHits = 0;

for (let i = 0; i < Math.min(1000, recordIndex.length); i++) {
  const accessStart = Date.now();
  const result = sequentialStore.tryGetRecord(i);
  const accessTime = Date.now() - accessStart;

  if (result.ok) {
    seqHits++;
    // Cache hits should be < 0.1ms, misses < 10ms
    if (accessTime < 0.5) {
      // Likely a cache hit
    }
  }
}

const seqTime = Date.now() - seqStart;
console.log(`Processed ${seqHits} records in ${seqTime}ms`);
console.log(`Average: ${(seqTime / seqHits).toFixed(3)}ms per record`);

// Strategy 2: Random access with large cache
console.log('\n--- Strategy 2: Random Access (Large Cache) ---');
console.log('Use case: User browsing, search results, non-sequential access');
console.log('Optimal cache size: 500-1000 records');

const randomStore = new MarcFile(buffer, recordIndex, 500);
console.log(`Created store with cache capacity: 500`);

// Simulate random access pattern
const randomStart = Date.now();
let randomHits = 0;
const accessedIndices = new Set<number>();

for (let i = 0; i < Math.min(1000, recordIndex.length); i++) {
  // Random access with some locality (70% repeat recent, 30% new)
  let index: number;
  if (Math.random() < 0.7 && accessedIndices.size > 0) {
    // Re-access a recent record
    const recentArray = Array.from(accessedIndices).slice(-100);
    index = recentArray[Math.floor(Math.random() * recentArray.length)];
  } else {
    // Access a new record
    index = Math.floor(Math.random() * Math.min(10000, recordIndex.length));
  }

  accessedIndices.add(index);
  const result = randomStore.tryGetRecord(index);

  if (result.ok) {
    randomHits++;
  }
}

const randomTime = Date.now() - randomStart;
console.log(`Processed ${randomHits} accesses to ${accessedIndices.size} unique records in ${randomTime}ms`);
console.log(`Average: ${(randomTime / randomHits).toFixed(3)}ms per access`);
console.log(`Cache efficiency: ${((randomHits - accessedIndices.size) / randomHits * 100).toFixed(1)}% cache hit rate`);

// Strategy 3: Memory-efficient editing
console.log('\n--- Strategy 3: Memory-Efficient Editing ---');
console.log('Use case: Modifying a subset of records in a large file');

const editStore = new MarcFile(buffer, recordIndex, 200); // Default cache
console.log(`Total records: ${editStore.totalRecords}`);

// Modify a small percentage (e.g., 1%)
const modifyCount = Math.ceil(editStore.totalRecords * 0.01);
console.log(`Modifying ${modifyCount} records (1% of file)...`);

// Note: In a real scenario, you'd actually modify records here
// For this example, we just demonstrate the memory characteristics
console.log(`\nMemory characteristics:`);
console.log(`  Base index: ~${(recordIndex.length * 16 / 1024).toFixed(2)} KB`);
console.log(`  Cache (200 records): ~${(200 * 2000 / 1024).toFixed(2)} KB (estimated)`);
console.log(`  Edit layer (${modifyCount} modified): ~${(modifyCount * 2000 / 1024).toFixed(2)} KB (estimated)`);
console.log(`  Original buffer: Not duplicated (immutable)`);

// Strategy 4: Streaming serialization
console.log('\n--- Strategy 4: Streaming Serialization ---');
console.log('Use case: Writing large modified files without loading all chunks into memory');

const outputFile = 'output-large.mrc';
console.log(`Streaming output to: ${outputFile}`);

const streamStart = Date.now();
const writeStream = createWriteStream(outputFile);

let chunkCount = 0;
let bytesWritten = 0;

for (const chunk of editStore.iterateSerializedRecords()) {
  writeStream.write(chunk);
  chunkCount++;
  bytesWritten += chunk.length;

  // Progress indicator for large files
  if (chunkCount % 10000 === 0) {
    console.log(`  Streamed ${chunkCount} records (${(bytesWritten / 1024 / 1024).toFixed(2)} MB)...`);
  }
}

writeStream.end();

const streamTime = Date.now() - streamStart;
console.log(`Streamed ${chunkCount} records (${(bytesWritten / 1024 / 1024).toFixed(2)} MB) in ${streamTime}ms`);
console.log(`Average: ${(streamTime / chunkCount).toFixed(3)}ms per record`);

// Performance recommendations
console.log('\n--- Performance Recommendations ---');
console.log('\n1. Cache Sizing:');
console.log('   - Sequential access: 50-100 records');
console.log('   - Random access: 500-1000 records');
console.log('   - Default (200): Good for mixed patterns');
console.log('   - Formula: cache_size = working_set_size * 1.5');

console.log('\n2. Memory Management:');
console.log('   - Original buffer is immutable (no duplication)');
console.log('   - Only modified/inserted records are stored in the edit layer');
console.log('   - Cache evicts LRU records automatically');
console.log('   - Total memory ≈ buffer + index + cache + edits');

console.log('\n3. Batch Processing:');
console.log('   - Use tryGetRecord() to avoid exceptions');
console.log('   - Process in chunks if memory constrained');
console.log('   - Stream serialization for large outputs');

console.log('\n4. Optimization Tips:');
console.log('   - Profile your access patterns first');
console.log('   - Tune cache based on measurements');
console.log('   - Use streaming for large file operations');
console.log('   - Consider processing in multiple passes if needed');

console.log('\n5. Expected Performance (typical hardware):');
console.log('   - 100K record index: ~10 seconds');
console.log('   - Cache hit: < 0.1ms');
console.log('   - Cache miss: < 10ms');
console.log('   - Serialization: ~100-200 MB/s');

console.log('\nPerformance testing complete!');
