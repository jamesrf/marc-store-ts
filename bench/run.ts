/**
 * Benchmarks for marc-store-ts over synthetic files.
 *
 * Usage: npm run bench [-- 10000,100000]
 * (builds first; imports the package by name, which resolves to dist/)
 *
 * Each operation runs on a fresh store; setup time is excluded. Reported time
 * is the median of several runs (fewer for slow operations).
 */

import { serializeMarcBinary, appendField } from 'marc-ts';
import type { MarcRecord } from 'marc-ts';
import {
  MarcFile,
  SearchIndex,
  scanBuffer,
  applyToAll,
  deleteMatching,
  toMarcBinary,
  toMarcXml,
} from 'marc-store-ts';

const sizes = (process.argv[2] ?? '10000,100000,250000').split(',').map(Number);

const topics = ['History', 'Science', 'Poetry', 'Economics', 'Music'];

function makeRecord(i: number): MarcRecord {
  return {
    leader: '00000nam a2200000 i 4500',
    fields: [
      { tag: '001', data: `bench${String(i).padStart(7, '0')}` },
      { tag: '008', data: '240101s2024    xxu           000 0 eng d' },
      {
        tag: '100',
        indicator1: '1',
        indicator2: ' ',
        subfields: [{ code: 'a', value: `Author ${i % 977}` }],
      },
      {
        tag: '245',
        indicator1: '1',
        indicator2: '0',
        subfields: [
          { code: 'a', value: `A study of ${topics[i % topics.length]!.toLowerCase()} :` },
          { code: 'b', value: `part ${i}` },
        ],
      },
      {
        tag: '650',
        indicator1: ' ',
        indicator2: '0',
        subfields: [{ code: 'a', value: topics[i % topics.length]! }],
      },
    ],
  };
}

const note = (r: MarcRecord): MarcRecord =>
  appendField(r, {
    tag: '500',
    indicator1: ' ',
    indicator2: ' ',
    subfields: [{ code: 'a', value: 'bench' }],
  });

// Deterministic pseudo-random positions so runs are comparable.
function lcg(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function measure<T>(setup: () => T, op: (state: T) => void, runs = 3): number {
  const times: number[] = [];
  for (let r = 0; r < runs; r++) {
    const state = setup();
    const start = performance.now();
    op(state);
    times.push(performance.now() - start);
    if (times[r]! > 5000) break; // don't repeat very slow operations
  }
  return median(times);
}

function fmt(ms: number): string {
  if (ms < 0.001) return `${(ms * 1e6).toFixed(0)} ns`;
  if (ms < 1) return `${(ms * 1000).toFixed(1)} µs`;
  if (ms < 1000) return `${ms.toFixed(1)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

const rows: Record<string, Record<number, string>> = {};
const record = (label: string, n: number, ms: number): void => {
  (rows[label] ??= {})[n] = fmt(ms);
};

for (const n of sizes) {
  const buffer = serializeMarcBinary(Array.from({ length: n }, (_, i) => makeRecord(i)));
  const quiet = { onIssue: () => {} };
  const fresh = (): MarcFile => MarcFile.fromBuffer(buffer, quiet);
  console.error(`n=${n}: ${(buffer.length / 1e6).toFixed(1)} MB`);

  record(
    'Index (scanBuffer)',
    n,
    measure(
      () => null,
      () => void scanBuffer(buffer)
    )
  );

  record(
    'Read all records, cold (parse)',
    n,
    measure(fresh, (s) => {
      for (const _ of s.iterateRecords());
    })
  );

  const warm = fresh();
  warm.getRecord(0);
  const hits = 100_000;
  record(
    'Cache hit (per read)',
    n,
    measure(
      () => null,
      () => {
        for (let i = 0; i < hits; i++) warm.getRecord(0);
      }
    ) / hits
  );

  record(
    'applyToAll (add a field to every record)',
    n,
    measure(fresh, (s) => void applyToAll(s, note), 1)
  );

  record(
    'deleteMatching (half the records)',
    n,
    measure(
      fresh,
      (s) =>
        void deleteMatching(
          s,
          (r) => Number((r.fields[0] as { data: string }).data.slice(5)) % 2 === 0
        ),
      1
    )
  );

  const edits = 1000;
  record(
    `${edits} single deletes, each followed by a read`,
    n,
    measure(
      fresh,
      (s) => {
        const rand = lcg(1);
        for (let i = 0; i < edits; i++) {
          s.deleteRecord(Math.floor(rand() * s.totalRecords));
          s.getRecord(Math.floor(rand() * s.totalRecords));
        }
      },
      1
    )
  );

  record(
    `${edits} single inserts, each followed by a read`,
    n,
    measure(
      fresh,
      (s) => {
        const rand = lcg(2);
        const extra = makeRecord(0);
        for (let i = 0; i < edits; i++) {
          s.insertRecord(extra, Math.floor(rand() * s.totalRecords));
          s.getRecord(Math.floor(rand() * s.totalRecords));
        }
      },
      1
    )
  );

  record(
    'toMarcBinary (unmodified)',
    n,
    measure(fresh, (s) => void toMarcBinary(s))
  );

  record(
    'toMarcBinary (every record modified)',
    n,
    measure(
      () => {
        const s = fresh();
        applyToAll(s, note);
        return s;
      },
      (s) => void toMarcBinary(s),
      1
    )
  );

  record(
    'toMarcXml',
    n,
    measure(fresh, (s) => void toMarcXml(s), 1)
  );

  record(
    'SearchIndex.build',
    n,
    measure(fresh, (s) => new SearchIndex().build(s), 1)
  );
}

console.log(
  `| Operation | ${sizes.map((n) => `${n.toLocaleString('en-US')} records`).join(' | ')} |`
);
console.log(`|---|${sizes.map(() => '---:').join('|')}|`);
for (const [label, byN] of Object.entries(rows)) {
  console.log(`| ${label} | ${sizes.map((n) => byN[n] ?? '').join(' | ')} |`);
}
