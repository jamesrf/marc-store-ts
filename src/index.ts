export { MarcFile } from './marc-file.js';
export type {
  RecordResult,
  RecordSlot,
  OriginalSlot,
  ModifiedSlot,
  DeletedSlot,
  InsertedSlot,
} from './types.js';
export type {
  ReadableStore,
  EditableStore,
  IdentifiedStore,
  RecordId,
  FromBufferOptions,
  StoreOptions,
} from './types.js';

export { MarcBase } from './marc-base.js';
export { EditLayer } from './edit-layer.js';

export { indexBuffer, scanBuffer } from './record-index.js';
export type { RecordIndex, IndexIssue, ScanOptions, ScanResult } from './record-index.js';

export * from './transform.js';

export { iterateRecordResults } from './iterate.js';
export type { OnRecordError, RecordErrorOptions } from './iterate.js';

export { SearchIndex, DEFAULT_SEARCH_FIELDS } from './search-index.js';
export type {
  SearchIndexOptions,
  SearchQueryOptions,
  SearchFieldExtractor,
  SearchResultItem,
} from './search-index.js';
