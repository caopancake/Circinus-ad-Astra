import { beforeEach, describe, expect, it, vi } from 'vitest';
import { entityTargetFixture } from '@/test/entity-target';
import { AppError } from '@/shared/lib/errors';
import type { EntityKind } from '@/shared/types';

const mocks = vi.hoisted(() => ({ focus: vi.fn(), query: vi.fn() }));
vi.mock('@/services/window.service', () => ({ focusNativeManagedWindow: mocks.focus }));
vi.mock('@/services/entity-query.service', () => ({ querySessionEntityEditTarget: mocks.query }));
import { focusEntityIdentityConflict, focusEntityWindowTarget, focusExistingEntityWindow } from './window-target-focus.orchestrator';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.focus.mockResolvedValue(false);
});

describe('conflicting window focus', () => {
  it.each(['ship', 'weapon', 'projectile', 'system'] as EntityKind[])(
    'focuses the %s specification before looking for a text window',
    async (kind) => {
      const target = entityTargetFixture(kind, 'Alpha');
      mocks.focus.mockResolvedValueOnce(true);
      const error = new AppError('Save failed', {
        cause: new AppError('Command failed', {
          cause: { code: 'spec.target_exists', message: 'exists', location: null, target },
        }),
      });
      await focusEntityIdentityConflict('s1', 'M:/mod', error);
      expect(mocks.focus).toHaveBeenCalledExactlyOnceWith({ type: 'spec', sessionId: 's1', modRoot: 'M:/mod', kind, id: 'Alpha' });
    },
  );

  it('uses the actual loaded text path when no specification window owns the entity', async () => {
    const target = entityTargetFixture('ship', 'Alpha');
    target.write.path = 'M:/mod/data/hulls/nested/custom.ship';
    mocks.focus.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await expect(focusEntityWindowTarget('s1', 'M:/mod', target)).resolves.toBe(true);
    expect(mocks.focus).toHaveBeenLastCalledWith({ type: 'file', sessionId: 's1', modRoot: 'M:/mod', path: target.write.path });
  });

  it.each(['variant', 'skin', 'faction', 'mission'] as EntityKind[])('focuses the loaded %s text target', async (kind) => {
    const target = entityTargetFixture(kind, 'Alpha');
    mocks.query.mockResolvedValueOnce({ target, baseVersions: [] });
    await focusExistingEntityWindow('s1', 'M:/mod', kind, 'Alpha');
    expect(mocks.query).toHaveBeenCalledExactlyOnceWith('s1', kind, 'Alpha');
    expect(mocks.focus).toHaveBeenCalledExactlyOnceWith({ type: 'file', sessionId: 's1', modRoot: 'M:/mod', path: target.write.path });
  });
});
