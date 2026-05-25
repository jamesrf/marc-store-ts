import { describe, it, expect } from 'vitest';
import { LRUCache } from '../lru-cache.js';

describe('LRUCache', () => {
  it('stores and retrieves values', () => {
    const cache = new LRUCache<string, number>(3);

    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
    expect(cache.get('d')).toBeUndefined();
  });

  it('evicts oldest when capacity exceeded', () => {
    const cache = new LRUCache<string, number>(3);

    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    // 'a' is oldest; adding 'd' should evict 'a'
    cache.set('d', 4);

    expect(cache.get('a')).toBeUndefined(); // evicted
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
    expect(cache.get('d')).toBe(4);
    expect(cache.size).toBe(3);
  });

  it('moves accessed entries to end (most recent)', () => {
    const cache = new LRUCache<string, number>(3);

    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    // Access 'a', making it most recent
    cache.get('a');

    // Now order is: b (oldest), c, a (newest)
    // Adding 'd' should evict 'b'
    cache.set('d', 4);

    expect(cache.get('a')).toBe(1); // still present
    expect(cache.get('b')).toBeUndefined(); // evicted
    expect(cache.get('c')).toBe(3);
    expect(cache.get('d')).toBe(4);
  });

  it('updates existing keys without eviction', () => {
    const cache = new LRUCache<string, number>(2);

    cache.set('a', 1);
    cache.set('b', 2);

    // Update 'a' (should not evict anything)
    cache.set('a', 10);

    expect(cache.get('a')).toBe(10);
    expect(cache.get('b')).toBe(2);
    expect(cache.size).toBe(2);
  });

  it('handles capacity = 1', () => {
    const cache = new LRUCache<string, number>(1);

    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    expect(cache.size).toBe(1);

    // Adding second item should evict first
    cache.set('b', 2);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.size).toBe(1);
  });

  it('has() does not affect recency', () => {
    const cache = new LRUCache<string, number>(2);

    cache.set('a', 1);
    cache.set('b', 2);

    // Check 'a' without moving it
    expect(cache.has('a')).toBe(true);

    // 'a' is still oldest, so adding 'c' should evict 'a'
    cache.set('c', 3);

    expect(cache.get('a')).toBeUndefined(); // evicted
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('delete() removes entries', () => {
    const cache = new LRUCache<string, number>(3);

    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    expect(cache.delete('b')).toBe(true);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.size).toBe(2);

    expect(cache.delete('nonexistent')).toBe(false);
    expect(cache.size).toBe(2);
  });

  it('clear() empties cache', () => {
    const cache = new LRUCache<string, number>(3);

    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBeUndefined();
  });

  it('throws error for invalid capacity', () => {
    expect(() => new LRUCache(0)).toThrow('Cache capacity must be greater than 0');
    expect(() => new LRUCache(-1)).toThrow('Cache capacity must be greater than 0');
  });

  it('handles various key types', () => {
    const numberCache = new LRUCache<number, string>(2);
    numberCache.set(1, 'one');
    numberCache.set(2, 'two');
    expect(numberCache.get(1)).toBe('one');

    const objectCache = new LRUCache<{ id: number }, string>(2);
    const key1 = { id: 1 };
    const key2 = { id: 2 };
    objectCache.set(key1, 'first');
    objectCache.set(key2, 'second');
    expect(objectCache.get(key1)).toBe('first');
    expect(objectCache.get(key2)).toBe('second');
  });

  it('maintains correct order with multiple operations', () => {
    const cache = new LRUCache<string, number>(3);

    cache.set('a', 1); // [a]
    cache.set('b', 2); // [a, b]
    cache.set('c', 3); // [a, b, c]

    cache.get('a'); // [b, c, a] - 'a' moved to end

    cache.set('d', 4); // [c, a, d] - 'b' evicted (oldest)

    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
    expect(cache.get('d')).toBe(4);

    cache.get('c'); // [a, d, c] - 'c' moved to end

    cache.set('e', 5); // [d, c, e] - 'a' evicted (oldest)

    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('d')).toBe(4);
    expect(cache.get('c')).toBe(3);
    expect(cache.get('e')).toBe(5);
  });
});
