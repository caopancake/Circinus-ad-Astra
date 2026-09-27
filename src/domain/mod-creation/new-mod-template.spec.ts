import { describe, expect, it } from 'vitest';
import { createDefaultNewModTemplate, validateNewModTemplate } from './new-mod-template';
import { getSchema } from '@/domain/schema/schema-registry';

describe('createDefaultNewModTemplate', () => {
  it('seeds version and gameVersion from the mod-info schema defaults', () => {
    const template = createDefaultNewModTemplate();
    expect(template.id).toBe('');
    expect(template.name).toBe('');

    const schema = getSchema('mod-info');
    expect(schema).not.toBeNull();
    const fields = (schema?.sections ?? []).flatMap((section) => section.fields);
    const versionField = fields.find((field) => field.key === 'file.version');
    const gameVersionField = fields.find((field) => field.key === 'file.gameVersion');
    expect(template.version).toBe(versionField?.default);
    expect(template.gameVersion).toBe(gameVersionField?.default);
  });
});

describe('validateNewModTemplate', () => {
  it('rejects ids that are empty, malformed or over the length cap', () => {
    expect(validateNewModTemplate({ id: '', name: 'n', version: '1', gameVersion: '1' })).toMatch(/Mod ID/);
    expect(validateNewModTemplate({ id: '_abc', name: 'n', version: '1', gameVersion: '1' })).toMatch(/Mod ID/);
    expect(validateNewModTemplate({ id: 'has space', name: 'n', version: '1', gameVersion: '1' })).toMatch(/Mod ID/);
    expect(validateNewModTemplate({ id: 'a/b', name: 'n', version: '1', gameVersion: '1' })).toMatch(/Mod ID/);
    expect(validateNewModTemplate({ id: 'a'.repeat(65), name: 'n', version: '1', gameVersion: '1' })).toMatch(/Mod ID/);
  });

  it('accepts ids built from letters, digits and the separator characters', () => {
    expect(validateNewModTemplate({ id: 'aBc012._-x', name: 'n', version: '1', gameVersion: '1' })).toBeNull();
  });

  it('rejects blank or oversized single-line fields', () => {
    expect(validateNewModTemplate({ id: 'ok', name: '  ', version: '1', gameVersion: '1' })).toMatch(/Mod 名称/);
    expect(validateNewModTemplate({ id: 'ok', name: 'n'.repeat(129), version: '1', gameVersion: '1' })).toMatch(/Mod 名称/);
    expect(validateNewModTemplate({ id: 'ok', name: 'n', version: 'v'.repeat(65), gameVersion: '1' })).toMatch(/版本号/);
    expect(validateNewModTemplate({ id: 'ok', name: 'n', version: '1', gameVersion: 'g'.repeat(65) })).toMatch(/游戏版本/);
  });

  it('rejects control characters in single-line fields', () => {
    expect(validateNewModTemplate({ id: 'ok', name: 'a\u0001b', version: '1', gameVersion: '1' })).toMatch(/控制字符/);
    expect(validateNewModTemplate({ id: 'ok', name: 'a\u007fb', version: '1', gameVersion: '1' })).toMatch(/控制字符/);
  });

  it('accepts a fully valid template', () => {
    expect(validateNewModTemplate({ id: 'my_mod-1.x', name: 'My Mod', version: '1.0.0', gameVersion: '0.97a' })).toBeNull();
  });
});
