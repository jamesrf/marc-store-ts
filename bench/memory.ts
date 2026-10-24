/**
 * Compares memory and load time of parsing a whole MARC file up front with
 * loading it into a MarcFile store.
 *
 * Usage: npm run bench:memory -- path/to/file.mrc
 * (builds first; imports the package by name, which resolves to dist/)
 *
 * Each mode runs in its own Node process so heaps don't interfere. Memory is
 * measured after a forced GC, relative to a baseline taken before the file is
 * read. "Heap" is JS objects; "buffers" is ArrayBuffer memory held outside the
 * heap (the raw file bytes).
 */

import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { parseMarcBinary } from 'marc-ts';
import { MarcFile } from 'marc-store-ts';

type Mode = 'eager' | 'store' | 'store-pass';

interface Result {
  mode: Mode;
  records: number;
  ms: number;
  heap: number;
  buffers: number;
}

const modes: Record<Mode, string> = {
  eager: 'parseMarcBinary (all records, buffer released)',
  store: 'MarcFile.fromBuffer',
  'store-pass': 'MarcFile.fromBuffer + read every record once',
};

const [file, childMode] = process.argv.slice(2) as [string | undefined, Mode | undefined];
if (!file) {
  console.error('Usage: npm run bench:memory -- path/to/file.mrc');
  process.exit(1);
}

function snapshot(): { heap: number; buffers: number } {
  globalThis.gc!();
  globalThis.gc!();
  const m = process.memoryUsage();
  return { heap: m.heapUsed, buffers: m.arrayBuffers };
}

// Held at module scope so the GC before the final snapshot can't collect it.
let keep: unknown;

function runChild(mode: Mode): void {
  const before = snapshot();
  const start = performance.now();
  let records: number;
  if (mode === 'eager') {
    // Read inside a closure so the buffer is unreachable once parsing is done,
    // which is the most favourable case for eager parsing.
    const parsed = parseMarcBinary(readFileSync(file!));
    records = parsed.length;
    keep = parsed;
  } else {
    const store = MarcFile.fromBuffer(readFileSync(file!), { onIssue: () => {} });
    if (mode === 'store-pass') for (const _ of store.iterateRecords());
    records = store.totalRecords;
    keep = store;
  }
  const ms = performance.now() - start;
  const after = snapshot();
  const result: Result = {
    mode,
    records,
    ms,
    heap: after.heap - before.heap,
    buffers: after.buffers - before.buffers,
  };
  console.log(JSON.stringify(result));
}

const mb = (bytes: number): string => `${(bytes / 1e6).toFixed(1)} MB`;

function runParent(): void {
  const fileSize = readFileSync(file!).length;
  console.error(`${file}: ${mb(fileSize)}`);

  const results: (Result | { mode: Mode; error: string })[] = [];
  for (const mode of Object.keys(modes) as Mode[]) {
    console.error(`running ${mode}…`);
    const child = spawnSync(
      process.execPath,
      [
        '--expose-gc',
        '--max-old-space-size=16384',
        '--experimental-strip-types',
        '--no-warnings',
        import.meta.filename,
        file!,
        mode,
      ],
      { encoding: 'utf8', maxBuffer: 1e6 }
    );
    if (child.status === 0) results.push(JSON.parse(child.stdout.trim()) as Result);
    else results.push({ mode, error: child.stderr.trim().split('\n').pop() ?? 'failed' });
  }

  console.log('| Mode | Records | Time | Heap | Buffers | Total | × file size |');
  console.log('|---|---:|---:|---:|---:|---:|---:|');
  for (const r of results) {
    if ('error' in r) {
      console.log(`| ${modes[r.mode]} | failed: ${r.error} | | | | | |`);
      continue;
    }
    const total = r.heap + r.buffers;
    console.log(
      `| ${modes[r.mode]} | ${r.records.toLocaleString('en-US')} | ${r.ms.toFixed(0)} ms | ` +
        `${mb(r.heap)} | ${mb(r.buffers)} | ${mb(total)} | ${(total / fileSize).toFixed(1)}× |`
    );
  }
}

if (childMode) runChild(childMode);
else runParent();

void keep;
