import { describe, expect, it } from 'vitest';
import { entityTargetFixture } from '@/test/entity-target';
import { captureIdentityVersions, handoffTableVersions, windowIdentityKey } from './entity-identity';

describe('identity version handoff', () => {
  it('retains loaded credentials for the same physical target and captures a distinct destination', () => {
    const baseline = [{ path: 'M:/mod/data/hulls/Demo.ship', fingerprint: 'loaded' }];
    for (const path of ['M:/mod/data/hulls/Demo.ship', '\\\\?\\m:\\MOD\\data\\hulls\\demo.ship']) {
      expect(captureIdentityVersions(baseline, { path, fingerprint: 'external' })).toEqual(baseline);
    }
    const destination = { path: 'M:/mod/data/hulls/Next.ship', fingerprint: null };
    expect(captureIdentityVersions(baseline, destination)).toEqual([...baseline, destination]);
  });
  it('adopts prepared CSV credentials while retaining the loaded spec credential', () => {
    const target = entityTargetFixture('weapon', 'demo');
    const csv = 'M:/mod/data/weapons/weapon_data.csv';
    const baseline = [
      { path: target.write.path, fingerprint: 'loaded-spec' },
      { path: csv, fingerprint: 'old-table' },
    ];
    expect(
      handoffTableVersions(baseline, {
        target,
        baseVersions: [
          { path: target.write.path, fingerprint: 'external-spec' },
          { path: csv, fingerprint: 'saved-table' },
        ],
      }),
    ).toEqual([
      { path: target.write.path, fingerprint: 'loaded-spec' },
      { path: csv, fingerprint: 'saved-table' },
    ]);
  });
  it('compares the typed window identity using domain IDs and Windows paths', () => {
    const left = { type: 'spec' as const, sessionId: 'session', kind: 'ship' as const, modRoot: 'D:/Mod/', id: 'Demo' };
    expect(windowIdentityKey(left)).toBe(windowIdentityKey({ ...left, modRoot: '\\\\?\\d:\\mod' }));
    expect(windowIdentityKey(left)).not.toBe(windowIdentityKey({ ...left, id: 'demo' }));
    expect(windowIdentityKey(left)).not.toBe(windowIdentityKey({ ...left, sessionId: 'Session' }));
  });
});
