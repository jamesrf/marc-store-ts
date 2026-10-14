export { MarcFile, MarcFile as RecordStore } from './record-store.js';
export type { RecordResult, RecordSlot } from './types.js';
export type { ReadableStore, EditableStore, FromBufferOptions, StoreOptions } from './types.js';

export { MarcBase } from './marc-base.js';
export { EditLayer } from './edit-layer.js';

export { indexBuffer, scanBuffer } from './record-index.js';
export type { RecordIndex, IndexIssue, ScanOptions, ScanResult } from './record-index.js';

export * from './transform.js';

export { SearchIndex, DEFAULT_SEARCH_FIELDS } from './search-index.js';
export type { SearchIndexOptions, SearchFieldExtractor, SearchResultItem } from './search-index.js';
