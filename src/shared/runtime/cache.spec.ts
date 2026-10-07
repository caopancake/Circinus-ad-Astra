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

  it('bumps and deletes versions per key', () => {
    const cache = createRuntimeCache<string, number>({ capacity: 2 });
    expect(cache.versionOf('a')).toBe(0);
    cache.bumpVersion('a');
    cache.bumpVersion('a');
    expect(cache.versionOf('a')).toBe(2);
    cache.deleteVersion('a');
    expect(cache.versionOf('a')).toBe(0);
  });

  it('deleting an entry also drops its version', () => {
    const cache = createRuntimeCache<string, number>({ capacity: 2 });
    cache.set('a', 1);
    cache.bumpVersion('a');
    cache.delete('a');
    expect(cache.has('a')).toBe(false);
    expect(cache.versionOf('a')).toBe(0);
  });

  it('keeps pending values isolated per key and type-safe at the call site', () => {
    const cache = createRuntimeCache<string, number>({ capacity: 2 });
    cache.setPending('a', { promise: Promise.resolve() });
    expect(cache.getPending<{ promise: Promise<void> }>('a')).toBeDefined();
    cache.deletePending('a');
    expect(cache.getPending('a')).toBeUndefined();
  });

  it('iterates pending keys independently from settled values', () => {
    const cache = createRuntimeCache<string, number>({ capacity: 2 });
    cache.set('settled', 1);
    cache.setPending('pending', { ready: true });
    expect([...cache.keys()]).toEqual(['settled']);
    expect([...cache.pendingKeys()]).toEqual(['pending']);
  });

  it('reset clears entries, versions and pending state', () => {
    const cache = createRuntimeCache<string, number>({ capacity: 4 });
    cache.set('a', 1);
    cache.bumpVersion('a');
    cache.setPending('a', { ready: true });
    cache.reset();
    expect(cache.size).toBe(0);
    expect(cache.versionOf('a')).toBe(0);
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
