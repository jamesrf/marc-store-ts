# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows
[Semantic Versioning](https://semver.org/) (pre-1.0: minor versions may contain breaking changes).

## [Unreleased]

### Added
- `scanBuffer()` returns `{ index, issues, bytesConsumed }` so callers can detect a partially indexed file. Its `recover` option skips corrupt records by resynchronising on the next record terminator.
- `MarcFile.fromBuffer` / `MarcBase.fromBuffer` accept an options object (`cacheCapacity`, `recover`, `onIssue`) and expose `indexIssues`. A plain cache-capacity number is still accepted.
- `LICENSE` file (MIT) and full package metadata (`description`, `repository`, `homepage`, `bugs`, `keywords`).
- `examples/generate-sample-data.ts` and an `npm run examples` script that runs every example in CI.

### Changed
- Minimum Node.js version is now 22 (was 24); CI tests Node 22, 24 and 26.
- Examples are now type-checked, linted and formatted alongside `src/`.
- The release workflow reuses the CI checks and publishes the exact tarball that passed them.

### Fixed
- README: Node requirement, scripts list, `marc-ts` link and architecture description now match the code; unbenchmarked timing claims removed.
- Examples README: replaced an outdated `marc-ts` snippet and `ts-node` instructions.
- Indexing no longer stops at whitespace between records, so newline-separated MARC files are fully indexed instead of silently truncated after the first record.
- Indexing reports records that are missing the 0x1D record terminator.
- `setRecord` and `insertRecord` no longer freeze the caller's record object in place. The store now keeps a frozen copy (reusing any already-frozen parts), so `getRecord` returns an equal record rather than the identical object that was passed in.
- `toMarcXml` now escapes tag, indicator and subfield-code attributes; an indicator such as `"` previously produced invalid XML.

## [0.1.0] - 2026-05-25

Initial release.
