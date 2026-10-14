import { describe, it, expect } from 'vitest';
import type { MarcRecord } from 'marc-ts';
import { getField, isDataField } from 'marc-ts';
import { MarcFile } from '../marc-file.js';
import { deleteMatching } from '../transform.js';
import { SearchIndex, DEFAULT_SEARCH_FIELDS } from '../search-index.js';
import {
  createMultiRecordBuffer,
  createTypicalRecord,
  serializeRecord,
} from './helpers/test-data.js';

function recordWith(fields: MarcRecord['fields']): MarcRecord {
  return { leader: '00000nam  2200000   4500', fields };
}

const catcherRecord = recordWith([
  { tag: '001', data: '00000001' },
  {
    tag: '100',
    indicator1: '1',
    indicator2: ' ',
    subfields: [{ code: 'a', value: 'Salinger, J. D.' }],
  },
  {
    tag: '245',
    indicator1: '1',
    indicator2: '0',
    subfields: [{ code: 'a', value: 'The Catcher in the Rye' }],
  },
  {
    tag: '650',
    indicator1: ' ',
    indicator2: '0',
    subfields: [{ code: 'a', value: 'Teenagers -- Fiction' }],
  },
]);

const mobyDickRecord = recordWith([
  { tag: '001', data: '00000002' },
  {
    tag: '100',
    indicator1: '1',
    indicator2: ' ',
    subfields: [{ code: 'a', value: 'Melville, Herman' }],
  },
  {
    tag: '245',
    indicator1: '1',
    indicator2: '0',
    subfields: [{ code: 'a', value: 'Moby Dick' }],
  },
  {
    tag: '650',
    indicator1: ' ',
    indicator2: '0',
    subfields: [{ code: 'a', value: 'Whaling -- Fiction' }],
  },
]);

function bufferFrom(records: MarcRecord[]): Uint8Array {
  const chunks = records.map(serializeRecord);
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

describe('SearchIndex', () => {
  it('builds from a store and finds a record by title', () => {
    const store = MarcFile.fromBuffer(createMultiRecordBuffer(5));
    const index = new SearchIndex();
    index.build(store);

    expect(index.size).toBe(5);
    const results = index.search('00000002');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.position).toBe(2);
    expect(store.getRecord(results[0]!.position).leader).toBe(store.getRecord(2).leader);
  });

  it('returns empty results and zero size for an empty store', () => {
    const store = MarcFile.fromBuffer(new Uint8Array(0));
    const index = new SearchIndex();
    index.build(store);

    expect(index.size).toBe(0);
    expect(index.search('anything')).toEqual([]);
  });

  it('matches only the record with the queried subject', () => {
    const store = MarcFile.fromBuffer(bufferFrom([catcherRecord, mobyDickRecord]));
    const index = new SearchIndex();
    index.build(store);

    const results = index.search('whaling');
    expect(results.map((r) => r.position)).toEqual([1]);
  });

  it('matches records by author', () => {
    const store = MarcFile.fromBuffer(bufferFrom([catcherRecord, mobyDickRecord]));
    const index = new SearchIndex();
    index.build(store);

    const results = index.search('salinger');
    expect(results.map((r) => r.position)).toEqual([0]);
  });

  it('build again reflects deletions made after the initial build', () => {
    const store = MarcFile.fromBuffer(bufferFrom([catcherRecord, mobyDickRecord]));
    const index = new SearchIndex();
    index.build(store);
    expect(index.search('whaling').length).toBe(1);

    deleteMatching(store, (r) => {
      const f = getField(r, '001');
      return f !== undefined && !isDataField(f) && f.data === '00000002';
    });
    index.build(store);

    expect(index.size).toBe(store.totalRecords);
    expect(index.search('whaling')).toEqual([]);
  });

  it('honors a custom fields option instead of the defaults', () => {
    const store = MarcFile.fromBuffer(bufferFrom([catcherRecord, mobyDickRecord]));
    const index = new SearchIndex({
      fields: [{ name: 'author', extract: DEFAULT_SEARCH_FIELDS[1]!.extract }],
    });
    index.build(store);

    // Title terms should no longer match, since only 'author' is indexed.
    expect(index.search('catcher rye')).toEqual([]);
    expect(index.search('melville').map((r) => r.position)).toEqual([1]);
  });

  it('supports multiple independent indexes scoped to different fields over the same store', () => {
    const store = MarcFile.fromBuffer(bufferFrom([catcherRecord, mobyDickRecord]));

    const subjectIndex = new SearchIndex({ fields: [DEFAULT_SEARCH_FIELDS[2]!] }); // subjects only
    const titleAuthorIndex = new SearchIndex({
      fields: [DEFAULT_SEARCH_FIELDS[0]!, DEFAULT_SEARCH_FIELDS[1]!], // title + author only
    });
    subjectIndex.build(store);
    titleAuthorIndex.build(store);

    expect(subjectIndex.search('whaling').map((r) => r.position)).toEqual([1]);
    expect(subjectIndex.search('melville')).toEqual([]);

    expect(titleAuthorIndex.search('melville').map((r) => r.position)).toEqual([1]);
    expect(titleAuthorIndex.search('whaling')).toEqual([]);
  });
});

describe('DEFAULT_SEARCH_FIELDS', () => {
  it('extracts title, author, and subjects independently from a record', () => {
    const [titleField, authorField, subjectsField, contentsField] = DEFAULT_SEARCH_FIELDS;

    expect(titleField!.extract(catcherRecord)).toEqual(['The Catcher in the Rye']);
    expect(authorField!.extract(catcherRecord)).toEqual(['Salinger, J. D.']);
    expect(subjectsField!.extract(catcherRecord)).toEqual(['Teenagers -- Fiction']);
    // contents doesn't repeat what title/author/subjects already index
    expect(contentsField!.extract(catcherRecord)).toEqual([]);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(DEFAULT_SEARCH_FIELDS)).toBe(true);
    expect(DEFAULT_SEARCH_FIELDS.every((f) => Object.isFrozen(f))).toBe(true);
    expect(() => (DEFAULT_SEARCH_FIELDS as unknown as unknown[]).push({})).toThrow(TypeError);
  });

  it('indexes added entries 700/710/711/720 as authors, but not linking entries', () => {
    const record = recordWith([
      {
        tag: '700',
        indicator1: '1',
        indicator2: ' ',
        subfields: [{ code: 'a', value: 'Coauthor, A.' }],
      },
      {
        tag: '711',
        indicator1: '2',
        indicator2: ' ',
        subfields: [{ code: 'a', value: 'Meeting' }],
      },
      {
        tag: '776',
        indicator1: '0',
        indicator2: '8',
        subfields: [{ code: 'a', value: 'Linked, L.' }],
      },
    ]);
    const [, authorField, , contentsField] = DEFAULT_SEARCH_FIELDS;
    expect(authorField!.extract(record)).toEqual(['Coauthor, A.', 'Meeting']);
    expect(contentsField!.extract(record)).toEqual(['Linked, L.']);
  });

  it('keeps subfields the named fields skip in contents', () => {
    const record = recordWith([
      {
        tag: '245',
        indicator1: '1',
        indicator2: '0',
        subfields: [
          { code: 'a', value: 'Title' },
          { code: 'c', value: 'by Someone' },
        ],
      },
      {
        tag: '650',
        indicator1: ' ',
        indicator2: '0',
        subfields: [
          { code: 'a', value: 'Whales' },
          { code: 'z', value: 'Pacific' },
        ],
      },
      { tag: '500', indicator1: ' ', indicator2: ' ', subfields: [{ code: 'a', value: 'A note' }] },
    ]);
    const contentsField = DEFAULT_SEARCH_FIELDS[3]!;
    expect(contentsField.extract(record)).toEqual(['by Someone', 'Pacific', 'A note']);
  });

  it('returns an empty array for fields absent from a record', () => {
    const minimal = recordWith([{ tag: '001', data: '00000099' }]);
    const [titleField, authorField, subjectsField] = DEFAULT_SEARCH_FIELDS;

    expect(titleField!.extract(minimal)).toEqual([]);
    expect(authorField!.extract(minimal)).toEqual([]);
    expect(subjectsField!.extract(minimal)).toEqual([]);
  });
});

describe('SearchIndex with edits after build', () => {
  const twoBooks = () => MarcFile.fromBuffer(bufferFrom([catcherRecord, mobyDickRecord]));

  it('returns stable IDs alongside positions', () => {
    const store = twoBooks();
    const index = new SearchIndex();
    index.build(store);
    const [hit] = index.search('melville');
    expect(hit).toMatchObject({ id: 1, position: 1 });
  });

  it('follows position shifts from inserts and deletes without a rebuild', () => {
    const store = twoBooks();
    const index = new SearchIndex();
    index.build(store);
    store.insertRecord(createTypicalRecord('new'), 0);
    store.insertRecord(createTypicalRecord('new2'), 0);
    const [hit] = index.search('melville');
    expect(hit!.position).toBe(3);
    expect(store.getRecord(hit!.position).fields).toEqual(mobyDickRecord.fields);
  });

  it('leaves deleted records out of results', () => {
    const store = twoBooks();
    const index = new SearchIndex();
    index.build(store);
    store.deleteRecord(1);
    expect(index.search('melville')).toEqual([]);
    store.revert(1);
    expect(index.search('melville').map((r) => r.position)).toEqual([1]);
  });

  it('applies limit after leaving out deleted records', () => {
    const store = twoBooks();
    const index = new SearchIndex();
    index.build(store);
    store.deleteRecord(0);
    expect(index.search('fiction', 1).map((r) => r.id)).toEqual([1]);
  });

  it('add(id) indexes new content for an edited record', () => {
    const store = twoBooks();
    const index = new SearchIndex();
    index.build(store);
    store.setRecord(0, mobyDickRecord);
    index.add(store.idAt(0), store.getRecord(0));
    expect(
      index
        .search('melville')
        .map((r) => r.position)
        .sort()
    ).toEqual([0, 1]);
    expect(index.size).toBe(2);
  });

  it('add(id) makes an inserted record searchable at its current position', () => {
    const store = twoBooks();
    const index = new SearchIndex();
    index.build(store);
    store.insertRecord(catcherRecord, 0);
    index.add(store.idAt(1), store.getRecord(1));
    expect(
      index
        .search('salinger')
        .map((r) => r.position)
        .sort()
    ).toEqual([0, 1]);
  });

  it('uses positions as IDs for a store without ID support', () => {
    const store = twoBooks();
    const plain = {
      get totalRecords() {
        return store.totalRecords;
      },
      getRecord: (p: number) => store.getRecord(p),
      tryGetRecord: (p: number) => store.tryGetRecord(p),
      iterateRecords: () => store.iterateRecords(),
      iterateSerializedRecords: () => store.iterateSerializedRecords(),
      getSerializedRecord: (p: number) => store.getSerializedRecord(p),
    };
    const index = new SearchIndex();
    index.build(plain);
    expect(index.search('melville')).toMatchObject([{ id: 1, position: 1 }]);
  });
});

describe('SearchIndex.search options', () => {
  const store = () => MarcFile.fromBuffer(bufferFrom([catcherRecord, mobyDickRecord]));
  const built = () => {
    const s = store();
    const index = new SearchIndex();
    index.build(s);
    return { s, index };
  };

  it('still accepts a number as the limit', () => {
    const { index } = built();
    expect(index.search('fiction', 1)).toHaveLength(1);
    expect(index.search('fiction', { limit: 1 })).toHaveLength(1);
  });

  it('restricts the search to the given fields', () => {
    const { index } = built();
    expect(index.search('melville', { fields: ['title'] })).toEqual([]);
    expect(index.search('melville', { fields: ['author'] }).map((r) => r.id)).toEqual([1]);
  });

  it('combines terms with AND when asked', () => {
    const { index } = built();
    expect(index.search('whaling teenagers').length).toBe(2);
    expect(index.search('whaling teenagers', { combineWith: 'AND' })).toEqual([]);
  });

  it('can turn off fuzzy and prefix matching per query', () => {
    const { index } = built();
    expect(index.search('melvile').length).toBeGreaterThan(0);
    expect(index.search('melvile', { fuzzy: false, prefix: false })).toEqual([]);
  });

  it('applies filter to current positions before the limit', () => {
    const { s, index } = built();
    s.insertRecord(catcherRecord, 0);
    index.add(s.idAt(1), s.getRecord(1));
    const results = index.search('fiction', { filter: (r) => r.position > 0, limit: 1 });
    expect(results).toHaveLength(1);
    expect(results[0]!.position).toBeGreaterThan(0);
  });
});
