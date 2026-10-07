/**
 * Runtime cache primitive: insertion-order LRU capacity eviction, per-key version
 * counters, pending deduplication and full reset. Semantic layers (invalidation
 * matching, batch loading, performance instrumentation) are implemented on top by the
 * individual cache services. State is plain data held in a closure; caches needing
 * reactive views (such as the media projection) handle that in their own service layer,
 * keeping this primitive framework-agnostic.
 */

export interface RuntimeCacheOptions {
  capacity: number;
  onEvict?: (key: string) => void;
}

export interface RuntimeCache<TKey extends string, TValue> {
  readonly size: number;
  get(key: TKey): TValue | undefined;
  peek(key: TKey): TValue | undefined;
  has(key: TKey): boolean;
  set(key: TKey, value: TValue): void;
  delete(key: TKey): void;
  keys(): IterableIterator<TKey>;
  pendingKeys(): IterableIterator<TKey>;
  versionOf(key: TKey): number;
  bumpVersion(key: TKey): void;
  deleteVersion(key: TKey): void;
  hasPending(key: TKey): boolean;
  getPending<TPending = unknown>(key: TKey): TPending | undefined;
  setPending<TPending>(key: TKey, pending: TPending): void;
  deletePending(key: TKey): void;
  reset(): void;
}

export function createRuntimeCache<TKey extends string, TValue>(options: RuntimeCacheOptions): RuntimeCache<TKey, TValue> {
  const { capacity } = options;
  const onEvict = options.onEvict;
  const cache = new Map<TKey, TValue>();
  const versions = new Map<TKey, number>();
  const pending = new Map<TKey, unknown>();

  function touchKey(key: TKey): void {
    const value = cache.get(key);
    if (value === undefined) return;
    cache.delete(key);
    cache.set(key, value);
  }

  function evictOverCapacity(): void {
    while (cache.size > capacity) {
      const oldest = cache.keys().next().value as TKey | undefined;
      if (oldest === undefined) return;
      cache.delete(oldest);
      versions.delete(oldest);
      onEvict?.(oldest);
    }
  }

  return {
    get size() {
      return cache.size;
    },
    get(key) {
      const value = cache.get(key);
      if (value === undefined) return undefined;
      touchKey(key);
      return value;
    },
    peek(key) {
      return cache.get(key);
    },
    has(key) {
      return cache.has(key);
    },
    set(key, value) {
      cache.set(key, value);
      evictOverCapacity();
    },
    delete(key) {
      cache.delete(key);
      versions.delete(key);
    },
    keys() {
      return cache.keys();
    },
    pendingKeys() {
      return pending.keys();
    },
    versionOf(key) {
      return versions.get(key) ?? 0;
    },
    bumpVersion(key) {
      versions.set(key, (versions.get(key) ?? 0) + 1);
    },
    deleteVersion(key) {
      versions.delete(key);
    },
    hasPending(key) {
      return pending.has(key);
    },
    getPending<TPending>(key: TKey) {
      return pending.get(key) as TPending | undefined;
    },
    setPending<TPending>(key: TKey, value: TPending) {
      pending.set(key, value);
    },
    deletePending(key: TKey) {
      pending.delete(key);
    },
    reset() {
      cache.clear();
      versions.clear();
      pending.clear();
    },
  };
}
