import { describe, expect, it } from 'vitest';
import { pathBelongsToRoot, normalizeFsPath } from '@/shared/lib/paths';

describe('Windows path ownership', () => {
  it('normalizes UNC, extended UNC, duplicate separators and trailing separators', () => {
    expect(normalizeFsPath('\\\\?\\UNC\\Server\\Share\\Mod\\')).toBe('//server/share/mod');
    expect(normalizeFsPath('\\\\Server\\Share\\Mod')).toBe('//server/share/mod');
    expect(normalizeFsPath('D:/Mod//nested/')).toBe('d:/mod/nested');
    expect(normalizeFsPath('/tmp/mod/')).toBe('/tmp/mod');
  });
  it('treats extended and drive paths as the same root', () => {
    expect(pathBelongsToRoot('D:\\game\\mods\\demo\\data.csv', '\\\\?\\D:\\game\\mods\\demo')).toBe(true);
    expect(pathBelongsToRoot('\\\\?\\D:\\game\\mods\\demo\\data.csv', 'D:\\game\\mods\\demo')).toBe(true);
  });

  it('rejects paths outside the extended root', () => {
    expect(pathBelongsToRoot('D:\\game\\mods\\other\\data.csv', '\\\\?\\D:\\game\\mods\\demo')).toBe(false);
  });
});
