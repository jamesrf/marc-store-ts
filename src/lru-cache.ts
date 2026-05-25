/**
 * LRU (Least Recently Used) cache implementation.
 *
 * Uses a Map for O(1) lookups and maintains insertion order.
 * When capacity is exceeded, evicts the oldest (least recently used) entry.
 */
export class LRUCache<K, V> {
  private map: Map<K, V>;
  private readonly capacity: number;

  constructor(capacity: number) {
    if (capacity <= 0) {
      throw new Error('Cache capacity must be greater than 0');
    }
    this.capacity = capacity;
    this.map = new Map();
  }

  /**
   * Get value by key. If found, moves entry to end (most recent).
   * @returns Value if exists, undefined otherwise
   */
  get(key: K): V | undefined {
    if (!this.map.has(key)) {
      return undefined;
    }

    // Move to end (most recent) by delete + set
    const value = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  /**
   * Set key-value pair. If key exists, updates and moves to end.
   * If at capacity, evicts oldest entry before inserting.
   */
  set(key: K, value: V): void {
    // If key exists, delete it first (we'll re-add at end)
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.capacity) {
      // At capacity and key is new: evict oldest (first entry)
      const firstKey = this.map.keys().next().value!;
      this.map.delete(firstKey);
    }

    // Add/update at end (most recent)
    this.map.set(key, value);
  }

  /**
   * Remove entry by key.
   * @returns true if key existed, false otherwise
   */
  delete(key: K): boolean {
    return this.map.delete(key);
  }

  /**
   * Check if key exists (does NOT affect recency).
   */
  has(key: K): boolean {
    return this.map.has(key);
  }

  /**
   * Remove all entries.
   */
  clear(): void {
    this.map.clear();
  }

  /**
   * Current number of entries.
   */
  get size(): number {
    return this.map.size;
  }
}
