import type { RowData } from '@/shared/types';
import { str } from '@/shared/lib/starsector';
import { nextFormattedId } from '@/domain/editors/lib/ship-slots';

export function createProjectileEngineSlot(slots: RowData[]): RowData {
  const id = nextFormattedId(new Set(slots.map((slot) => str(slot.id))), (index) => `ES${index}`);
  return {
    id,
    loc: [0, 0],
    angle: 180,
    width: 8,
    length: 20,
    style: 'CUSTOM',
    styleSpec: {
      mode: 'QUAD_STRIP',
      engineColor: [255, 145, 75, 255],
      contrailColor: [100, 100, 100, 150],
      contrailDuration: 0.5,
      contrailWidthMult: 2,
      contrailMaxSpeedMult: 0,
      contrailAngularVelocityMult: 0.5,
      type: 'SMOKE',
    },
  };
}
