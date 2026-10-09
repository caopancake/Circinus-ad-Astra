import { describe, expect, it } from 'vitest';
import { createRuntimeCache } from './cache';

describe('createRuntimeCache', () => {
  it('stores and retrieves values', () => {
    const cache = createRuntimeCache<string, number>({ capacity: 4 });
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    expect(cache.has('a')).toBe(true);
    expect(cache.size).toBe(1);
  });

  it('evicts the oldest entry beyond capacity', () => {
    const cache = createRuntimeCache<string, number>({ capacity: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.has('a')).toBe(false);
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
    expect(cache.size).toBe(2);
  });

  it('get refreshes recency and protects entries from eviction', () => {
    const cache = createRuntimeCache<string, number>({ capacity: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.set('c', 3);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
  });

  it('set refreshes recency for replacement values', () => {
    const cache = createRuntimeCache<string, number>({ capacity: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 3);
    cache.set('c', 4);
    expect([...cache.keys()]).toEqual(['a', 'c']);
    expect(cache.peek('a')).toBe(3);
  });

  it('peek, has and iteration retain access order', () => {
    const cache = createRuntimeCache<string, number>({ capacity: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.peek('a');
    cache.has('a');
    expect([...cache.keys()]).toEqual(['a', 'b']);
    cache.set('c', 3);
    expect(cache.has('a')).toBe(false);
  });

  it('keeps pending values isolated per key and type-safe at the call site', () => {
    const cache = createRuntimeCache<string, number, { promise: Promise<void> }>({ capacity: 2 });
    cache.setPending('a', { promise: Promise.resolve() });
    expect(cache.getPending('a')).toBeDefined();
    cache.deletePending('a');
    expect(cache.getPending('a')).toBeUndefined();
  });

  it('iterates pending keys independently from settled values', () => {
    const cache = createRuntimeCache<string, number, { ready: boolean }>({ capacity: 2 });
    cache.set('settled', 1);
    cache.setPending('pending', { ready: true });
    expect([...cache.keys()]).toEqual(['settled']);
    expect([...cache.pendingKeys()]).toEqual(['pending']);
  });

  it('reset clears entries and pending state', () => {
    const cache = createRuntimeCache<string, number, { ready: boolean }>({ capacity: 4 });
    cache.set('a', 1);
    cache.setPending('a', { ready: true });
    cache.reset();
    expect(cache.size).toBe(0);
    expect(cache.getPending('a')).toBeUndefined();
  });

  it('keys iterates in insertion order after touch', () => {
    const cache = createRuntimeCache<string, number>({ capacity: 4 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    expect([...cache.keys()]).toEqual(['b', 'a']);
  });
});
