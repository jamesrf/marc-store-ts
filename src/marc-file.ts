import type { IndexIssue, RecordIndex } from './record-index.js';
import { scanBuffer } from './record-index.js';
import { MarcBase } from './marc-base.js';
import { EditLayer } from './edit-layer.js';
import type { FromBufferOptions, StoreOptions } from './types.js';
import { normalizeFromBufferOptions } from './types.js';

/**
 * A MARC file opened for reading and copy-on-write editing: the main entry
 * point. It is an `EditLayer` over a `MarcBase` built from the buffer, so it
 * has every reading, editing, stable-ID and serialization method of
 * `EditLayer`; `base` gives access to the underlying read-only store.
 */
export class MarcFile extends EditLayer {
  /**
   * @param rawBuffer - The complete MARC file
   * @param recordIndex - Record boundaries, from `scanBuffer` or `indexBuffer`
   * @param cacheCapacity - Maximum number of parsed records kept in the LRU cache
   * @param options - See `StoreOptions`
   */
  constructor(
    rawBuffer: ArrayBuffer | Uint8Array,
    recordIndex: RecordIndex[],
    cacheCapacity = 200,
    options: StoreOptions = {}
  ) {
    super(new MarcBase(rawBuffer, recordIndex, cacheCapacity, options));
  }

  /**
   * Index `buffer` with `scanBuffer` and construct a store over it.
   *
   * Indexing problems are available afterwards as `indexIssues`. If that is
   * non-empty the file may be only partially indexed, and exporting it would
   * drop the unindexed records. For backward compatibility, issues are also
   * logged with `console.warn` unless an `onIssue` callback is supplied.
   *
   * @param options - Options object, or (legacy) the cache capacity
   */
  static fromBuffer(
    buffer: Uint8Array | ArrayBuffer,
    options?: number | FromBufferOptions
  ): MarcFile {
    const {
      cacheCapacity = 200,
      copyBuffer,
      onIssue,
      ...scanOptions
    } = normalizeFromBufferOptions(options);
    const { index, issues } = scanBuffer(buffer, {
      ...scanOptions,
      onIssue: onIssue ?? ((issue) => console.warn(issue.message)),
    });
    return new MarcFile(buffer, index, cacheCapacity, { indexIssues: issues, copyBuffer });
  }

  /** Problems found while indexing the buffer; see `scanBuffer`. */
  get indexIssues(): readonly IndexIssue[] {
    return this.baseStore.indexIssues;
  }

  /** The underlying read-only store: the raw buffer, record index and LRU cache. */
  get base(): MarcBase {
    return this.baseStore;
  }
}
