/**
 * Generate a synthetic MARC21 file for running the examples.
 *
 * Usage: node examples/generate-sample-data.ts [output.mrc] [recordCount]
 */

import { writeFileSync } from 'fs';
import { serializeMarcBinary } from 'marc-ts';
import type { MarcRecord } from 'marc-ts';

const outputFile = process.argv[2] || 'sample-data.mrc';
const count = Number(process.argv[3] || 500);

const topics = ['History', 'Science', 'Poetry', 'Economics', 'Music'];
const authors = ['Smith, Jane', 'Doe, John', 'Garcia, Ana', 'Chen, Wei', 'Okafor, Ngozi'];

function makeRecord(i: number): MarcRecord {
  const topic = topics[i % topics.length]!;
  const author = authors[i % authors.length]!;
  return {
    leader: '00000nam a2200000 i 4500',
    fields: [
      { tag: '001', data: `sample${String(i).padStart(6, '0')}` },
      { tag: '008', data: '240101s2024    xxu           000 0 eng d' },
      {
        tag: '020',
        indicator1: ' ',
        indicator2: ' ',
        subfields: [{ code: 'a', value: `978000000${String(i).padStart(4, '0')}` }],
      },
      {
        tag: '100',
        indicator1: '1',
        indicator2: ' ',
        subfields: [{ code: 'a', value: author }],
      },
      {
        tag: '245',
        indicator1: '1',
        indicator2: '0',
        subfields: [
          { code: 'a', value: `A short history of ${topic.toLowerCase()} :` },
          { code: 'b', value: `volume ${i + 1}` },
        ],
      },
      {
        tag: '650',
        indicator1: ' ',
        indicator2: '0',
        subfields: [{ code: 'a', value: topic }],
      },
    ],
  };
}

const records = Array.from({ length: count }, (_, i) => makeRecord(i));
writeFileSync(outputFile, serializeMarcBinary(records));
console.log(`Wrote ${count} records to ${outputFile}`);
