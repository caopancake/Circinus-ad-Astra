import { describe, expect, it } from 'vitest';
import { configEntityIdInvalidMessage, createDefaultFaction } from '@/domain/config/config-entities';
import { configFactionSaveDraft, configMissionSaveDraft, configModInfoSaveData } from '@/domain/config/config-entities';
import { getSchema } from '@/domain/schema/schema-registry';

describe('configuration business content boundaries', () => {
  it('preserves top-level, dictionary and array object keys through every source split', () => {
    const content = { id: 'demo', _rowKey: 'business', nested: { _slot: 'weapon' }, values: [{ _field: 2 }] };
    expect(configModInfoSaveData({ file: content }, getSchema('mod-info')!)).toEqual(content);
    expect(configFactionSaveDraft({ file: content }, getSchema('faction')!).file).toEqual(content);
    const mission = configMissionSaveDraft(
      { list: { mission: 'demo', _column: 'cell' }, descriptor: content, text: { content: 'text' } },
      getSchema('mission')!,
    );
    expect(mission.descriptor).toEqual(content);
    expect(mission.list).toEqual({ mission: 'demo', _column: 'cell' });
  });
});

describe('new faction game contract', () => {
  it('contains the required loader fields and a core faction logo', () => {
    const faction = createDefaultFaction('new_faction');
    expect(faction).toMatchObject({
      id: 'new_faction',
      displayName: 'new_faction',
      displayNameWithArticle: 'new_faction',
      logo: 'graphics/factions/neutral_traders.png',
      names: { modern: 1 },
      portraits: {},
      color: [128, 128, 128, 255],
      baseUIColor: [128, 128, 128, 255],
      darkUIColor: [64, 64, 64, 255],
    });
    faction.names = {};
    expect(createDefaultFaction('other').names).toEqual({ modern: 1 });
  });
});

describe('config entity id invalid message', () => {
  it('appends the offending value when present', () => {
    expect(configEntityIdInvalidMessage('势力 ID', '我的势力')).toBe(
      '势力 ID "我的势力" 仅允许以 ASCII 字母或数字开头，只能包含 ASCII 字母、数字、下划线（_）、点（.）、连字符（-）',
    );
  });

  it('keeps the plain hint when the value is missing or empty', () => {
    const plain = '势力 ID 仅允许以 ASCII 字母或数字开头，只能包含 ASCII 字母、数字、下划线（_）、点（.）、连字符（-）';
    expect(configEntityIdInvalidMessage('势力 ID')).toBe(plain);
    expect(configEntityIdInvalidMessage('势力 ID', '')).toBe(plain);
  });
});
