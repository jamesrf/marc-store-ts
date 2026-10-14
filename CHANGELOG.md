# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows
[Semantic Versioning](https://semver.org/) (pre-1.0: minor versions may contain breaking changes).

## [Unreleased]

### Added
- `deleteRecords(positions)` and `insertRecords(records, afterPosition?)` on `MarcFile`, `EditLayer` and the `EditableStore` interface, for single-pass bulk edits.
- `npm run bench`: benchmarks over synthetic files of configurable size.
- `scanBuffer()` returns `{ index, issues, bytesConsumed }` so callers can detect a partially indexed file.
- `onError` option (`'throw'` | `'skip'` | callback) on `applyToAll`, `applyToMatching`, `deleteMatching`, `keepMatching`, `toMarcXml`, `toJson` and `SearchIndex.build`/`rebuild`, so one unparseable record no longer has to abort the whole operation. The default remains `'throw'`.
- `iterateRecordResults(store)`, yielding a `RecordResult` per position instead of throwing.
- `copyBuffer` option on `fromBuffer` (and the constructors' options) to isolate the store from later writes to the caller's buffer.
- `MarcBase.getSerializedRecordView()` for explicit zero-copy access to a record's original bytes.
- `MarcFile.fromBuffer` / `MarcBase.fromBuffer` accept an options object (`cacheCapacity`, `onIssue`, `copyBuffer`) and expose `indexIssues`. A plain cache-capacity number is still accepted.
- `LICENSE` file (MIT) and full package metadata (`description`, `repository`, `homepage`, `bugs`, `keywords`).
- `examples/generate-sample-data.ts` and an `npm run examples` script that runs every example in CI.

### Changed
- Minimum Node.js version is now 22 (was 24); CI tests Node 22, 24 and 26.
- Examples are now type-checked, linted and formatted alongside `src/`.
- The release workflow reuses the CI checks and publishes the exact tarball that passed them.

### Fixed
- `deleteMatching` / `keepMatching` were quadratic (each delete rebuilt the position map): 4.7 s for 50K records. They now use `deleteRecords` and take 0.18 s, scaling linearly.
- Records with a wrong leader length are now indexed by their 0x1D record terminator (reported as `length-mismatch`), parsed with the length corrected, and written out with a corrected leader. Previously one bad length made the record unparseable and stopped indexing, losing every record after it.
- Docs: `revertRecord` was documented as restoring deleted records, which it cannot do; the README and JSDoc now say to use `revertAll()`. (Per-record restore of deletions is planned with stable record IDs.)
- `getSerializedRecord()` now returns a copy. It previously returned a view into the store's buffer, so writing to the result corrupted the store. `iterateSerializedRecords()` still yields zero-copy views, now documented as read-only.
- README: Node requirement, scripts list, `marc-ts` link and architecture description now match the code; unbenchmarked timing claims removed.
- Examples README: replaced an outdated `marc-ts` snippet and `ts-node` instructions.
- Indexing no longer stops at whitespace between records, so newline-separated MARC files are fully indexed instead of silently truncated after the first record.
- Indexing reports records that are missing the 0x1D record terminator.
- `setRecord` and `insertRecord` no longer freeze the caller's record object in place. The store now keeps a frozen copy (reusing any already-frozen parts), so `getRecord` returns an equal record rather than the identical object that was passed in.
- `toMarcXml` now escapes tag, indicator and subfield-code attributes; an indicator such as `"` previously produced invalid XML.

## [0.1.0] - 2026-05-25

Initial release.
