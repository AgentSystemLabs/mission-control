/**
 * High-throughput LRU cache — Map index + doubly-linked list.
 *
 * - Map: O(1) key → node lookup
 * - List: O(1) promote/evict via pointer updates (no delete/re-insert on get)
 * - Eviction reuses the LRU node object to avoid an extra allocation
 */

/** @typedef {{ key: unknown, value: unknown, lastUsedAt: number, prev: Node | null, next: Node | null }} Node */

export class LruCache {
  /** @type {number} */
  #maxSize;

  /** @type {Map<unknown, Node>} */
  #index = new Map();

  /** @type {Node | null} LRU */
  #head = null;

  /** @type {Node | null} MRU */
  #tail = null;

  /**
   * @param {number} maxSize
   */
  constructor(maxSize) {
    if (!Number.isInteger(maxSize) || maxSize < 1) {
      throw new RangeError("maxSize must be a positive integer");
    }
    this.#maxSize = maxSize;
  }

  get maxSize() {
    return this.#maxSize;
  }

  get size() {
    return this.#index.size;
  }

  /**
   * @param {Node} node
   */
  #unlink(node) {
    const { prev, next } = node;
    if (prev) prev.next = next;
    else this.#head = next;

    if (next) next.prev = prev;
    else this.#tail = prev;

    node.prev = null;
    node.next = null;
  }

  /**
   * @param {Node} node
   */
  #append(node) {
    if (this.#tail === node) return;

    if (node.prev !== null || node.next !== null || this.#head === node) {
      this.#unlink(node);
    }

    const tail = this.#tail;
    node.prev = tail;
    node.next = null;

    if (tail) tail.next = node;
    else this.#head = node;

    this.#tail = node;
  }

  /**
   * @param {unknown} key
   * @param {unknown} value
   * @param {number} lastUsedAt
   * @returns {Node}
   */
  #createNode(key, value, lastUsedAt) {
    return { key, value, lastUsedAt, prev: null, next: null };
  }

  /**
   * @param {Node} node
   * @param {number} now
   */
  #promote(node, now) {
    node.lastUsedAt = now;
    this.#append(node);
  }

  /**
   * @param {unknown} key
   * @returns {unknown | undefined}
   */
  get(key) {
    const node = this.#index.get(key);
    if (node === undefined) return undefined;
    this.#promote(node, Date.now());
    return node.value;
  }

  /**
   * @param {unknown} key
   * @returns {boolean}
   */
  has(key) {
    return this.#index.has(key);
  }

  /**
   * @param {unknown} key
   * @returns {number | undefined}
   */
  getLastUsedAt(key) {
    return this.#index.get(key)?.lastUsedAt;
  }

  /**
   * @param {unknown} key
   * @param {unknown} value
   * @returns {{ key: unknown, value: unknown, lastUsedAt: number } | undefined}
   */
  set(key, value) {
    const now = Date.now();
    const existing = this.#index.get(key);

    if (existing !== undefined) {
      existing.value = value;
      this.#promote(existing, now);
      return undefined;
    }

    if (this.#index.size >= this.#maxSize) {
      const lru = /** @type {Node} */ (this.#head);
      const evicted = { key: lru.key, value: lru.value, lastUsedAt: lru.lastUsedAt };

      this.#index.delete(lru.key);
      this.#unlink(lru);

      lru.key = key;
      lru.value = value;
      lru.lastUsedAt = now;

      this.#index.set(key, lru);
      this.#append(lru);

      return evicted;
    }

    const node = this.#createNode(key, value, now);
    this.#index.set(key, node);
    this.#append(node);
    return undefined;
  }

  /**
   * @param {unknown} key
   * @returns {boolean}
   */
  unset(key) {
    const node = this.#index.get(key);
    if (node === undefined) return false;

    this.#index.delete(key);
    this.#unlink(node);
    return true;
  }

  clear() {
    this.#index.clear();
    this.#head = null;
    this.#tail = null;
  }

  /**
   * Snapshot LRU → MRU. O(n) — avoid on large caches in hot paths.
   * @returns {Array<{ key: unknown, value: unknown, lastUsedAt: number }>}
   */
  entries() {
    const out = [];
    for (let node = this.#head; node !== null; node = node.next) {
      out.push({ key: node.key, value: node.value, lastUsedAt: node.lastUsedAt });
    }
    return out;
  }
}

// ── Demo (node scripts/lru-cache.mjs) ───────────────────────────────────────

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));

if (isMain) {
  const cache = new LruCache(3);

  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);

  console.log("after seed:", cache.entries().map((e) => e.key));

  cache.get("a");
  console.log("after get(a):", cache.entries().map((e) => e.key));

  const evicted = cache.set("d", 4);
  console.log("evicted:", evicted?.key);
  console.log("order:", cache.entries().map((e) => e.key));

  cache.unset("a");
  console.log("after unset(a):", cache.has("a"));
  console.log("lastUsed(c):", new Date(cache.getLastUsedAt("c")).toISOString());
}
