# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows
[Semantic Versioning](https://semver.org/) (pre-1.0: minor versions may contain breaking changes).

## [Unreleased]

## [0.2.0] - 2026-10-14

This release fixes several data-loss and correctness bugs (indexing, MARC-8, search, XML escaping), adds stable record IDs, streaming exports and bulk edits, and cleans up the API. It contains breaking changes; see **Upgrading from 0.1.0** below.

### Upgrading from 0.1.0

| 0.1.0 | 0.2.0 |
|---|---|
| `RecordStore` | `MarcFile` |
| `store.edits.someMethod()` | `store.someMethod()` (`MarcFile` is an `EditLayer`) |
| `store.slots` | `store.getSlot(position)` or `store.iterateSlots()` |
| `base.indexCount` | `base.totalRecords` |
| `index.rebuild(store)` | `index.build(store)` (inserts and deletes no longer need it) |
| `index.add(position, record)` / `index.remove(position)` | `index.add(store.idAt(position), record)` / `index.remove(id)` |
| `toJson(store)` (simple shape) | `toJson(store, { format: 'simple' })`, or adopt MARC-in-JSON |
| `toMarcXml(store, { encoding })` | `toMarcXml(store)` (always UTF-8) |
| `toMarcBinary(store)` (MARC-8 bytes kept) | `toMarcBinary(store, { encoding: 'preserve' })` |
| Indexing warnings on the console | `store.indexIssues`, or `fromBuffer(buf, { onIssue: (i) => console.warn(i.message) })` |
| Implementing `EditableStore` yourself | Also implement `deleteRecords` and `insertRecords` |

### Breaking
- `SearchIndex` default fields: `author` now takes $a from 700/710/711/720 only, rather than every 7XX field (which included linking entries such as 776). `contents` no longer repeats the subfields that `title`, `author` and `subjects` index, so relevance scores change. `DEFAULT_SEARCH_FIELDS` is frozen; build a new array to customize it.
- Indexing problems are no longer logged with `console.warn`. They're returned by `scanBuffer`, exposed as `indexIssues` by `fromBuffer`, and passed to the `onIssue` callback if you supply one (`onIssue: (i) => console.warn(i.message)` restores the old logging).
- The `slots` getter on `MarcFile`/`EditLayer` is removed: it copied every slot on each access. Use `getSlot(position)` or `iterateSlots()`.
- `SearchIndex.rebuild()` is removed; it was an alias for `build()`.
- `MarcFile` now extends `EditLayer` instead of wrapping one, so it inherits every reading, editing and serialization method. The `MarcFile.edits` getter is removed (use the `MarcFile` itself).
- The `RecordStore` alias for `MarcFile` is removed; import `MarcFile`.
- `MarcBase.indexCount` is removed; use `totalRecords`, which is identical.
- Internal module `record-store.ts` is renamed `marc-file.ts` (only matters if you imported from `dist/` paths directly).
- `toMarcBinary` converts records stored as MARC-8 to UTF-8 by default, so its output never mixes encodings. Pass `{ encoding: 'preserve' }` for the previous byte-for-byte behaviour.
- `toJson` now writes MARC-in-JSON by default. The previous shape is available as `toJson(store, { format: 'simple' })`.
- `toMarcXml`'s `encoding` option is removed. It only changed the XML declaration, never the output, which is always UTF-8.
- `SearchIndex` `add()` and `remove()` take a stable record ID instead of a position; `search()` results gain an `id`. For an unedited store, ID and position are the same number.
- `getSerializedRecord()` returns a copy rather than a view into the store's buffer (writing to the old view corrupted the store). `iterateSerializedRecords()` still yields zero-copy views, now documented as read-only.
- `setRecord` and `insertRecord` store a frozen copy instead of freezing the caller's object in place, so `getRecord` returns an equal record rather than the identical object passed in.
- The `EditableStore` interface gains `deleteRecords` and `insertRecords`; custom implementations must add them.

### Added
- Generated API reference (TypeDoc, `npm run docs`), published to GitHub Pages; TSDoc on every public member of `MarcBase`, `EditLayer` and the store interfaces. The `OriginalSlot`, `ModifiedSlot`, `DeletedSlot` and `InsertedSlot` types are now exported.
- Per-query options for `SearchIndex.search(query, options)`: `limit`, `fields`, `combineWith`, `fuzzy`, `prefix`, `boost` and `filter`. A number is still accepted as the limit.
- `iterateMarcBinary(store)`, `iterateMarcXml(store)` and `iterateJson(store)` stream exports one chunk per record, for files too large to build as a single string.
- `toJson` options `format: 'marc-in-json' | 'simple'` and `ndjson`.
- `getSlot(position)` and `iterateSlots()` on `MarcFile` and `EditLayer`.
- Stable record IDs: `idAt(position)`, `positionOf(id)`, `getRecordById(id)`, `revert(id)` and `deletedIds()` on `MarcFile` and `EditLayer` (`MarcBase` has `idAt`/`positionOf`, where ID equals index), plus the `RecordId` type and `IdentifiedStore` interface. IDs don't change when other records move and are never reused. `revert(id)` can undo a deletion, which `revertRecord(position)` cannot.
- Every `RecordSlot` now has an `id`.
- `deleteRecords(positions)` and `insertRecords(records, afterPosition?)` on `MarcFile`, `EditLayer` and the `EditableStore` interface, for single-pass bulk edits.
- `npm run bench`: benchmarks over synthetic files of configurable size.
- `scanBuffer()` returns `{ index, issues, bytesConsumed }` so callers can detect a partially indexed file.
- `onError` option (`'throw'` | `'skip'` | callback) on `applyToAll`, `applyToMatching`, `deleteMatching`, `keepMatching`, `toMarcXml`, `toJson` and `SearchIndex.build`, so one unparseable record no longer has to abort the whole operation. The default remains `'throw'`.
- `iterateRecordResults(store)`, yielding a `RecordResult` per position instead of throwing.
- `copyBuffer` option on `fromBuffer` (and the constructors' options) to isolate the store from later writes to the caller's buffer.
- `MarcBase.getSerializedRecordView()` for explicit zero-copy access to a record's original bytes.
- `MarcFile.fromBuffer` / `MarcBase.fromBuffer` accept an options object (`cacheCapacity`, `onIssue`, `copyBuffer`) and expose `indexIssues`.
- `LICENSE` file (MIT) and full package metadata (`description`, `repository`, `homepage`, `bugs`, `keywords`).
- `examples/generate-sample-data.ts` and an `npm run examples` script that runs every example in CI.

### Changed
- `SearchIndex` keys documents by stable record ID: results report each record's current `position`, leave out records deleted since the build, and stay correct after inserts and deletes without rebuilding.
- Minimum Node.js version is now 22 (was 24); CI tests Node 22, 24 and 26.
- Examples are now type-checked, linted and formatted alongside `src/`.
- Development dependencies updated to clear all `npm audit` findings.
- The release workflow reuses the CI checks and publishes the exact tarball that passed them.

### Fixed
- `toMarcBinary` could write a file mixing MARC-8 (unedited records) and UTF-8 (edited records).
- XML and JSON exports labelled records from MARC-8 source files as MARC-8 (leader/09 = space) although their text is Unicode; leader/09 is now `a`.
- `SearchIndex` results pointed at the wrong record (or past the end) after any insert or delete until the index was rebuilt.
- `deleteMatching` / `keepMatching` were quadratic (each delete rebuilt the position map): 4.7 s for 50K records. They now use `deleteRecords` and take 0.18 s, scaling linearly.
- Records with a wrong leader length are now indexed by their 0x1D record terminator (reported as `length-mismatch`), parsed with the length corrected, and written out with a corrected leader. Previously one bad length made the record unparseable and stopped indexing, losing every record after it.
- Docs: `revertRecord` was documented as restoring deleted records, which it cannot do (a deleted record has no position). Use the new `revert(id)`.
- README: Node requirement, scripts list, `marc-ts` link and architecture description now match the code; unbenchmarked timing claims replaced with measured benchmarks.
- Examples README: replaced an outdated `marc-ts` snippet and `ts-node` instructions.
- Indexing no longer stops at whitespace between records, so newline-separated MARC files are fully indexed instead of silently truncated after the first record.
- Indexing reports records that are missing the 0x1D record terminator.
- `toMarcXml` now escapes tag, indicator and subfield-code attributes; an indicator such as `"` previously produced invalid XML.

## [0.1.0] - 2026-05-25

Initial release.

[Unreleased]: https://github.com/jamesrf/marc-store-ts/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/jamesrf/marc-store-ts/releases/tag/v0.2.0
