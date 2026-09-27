import { describe, expect, it } from 'vitest';
import type { Point } from '@/domain/editors/editor-types';
import {
  drawBarrelVisual,
  drawBoundsVisual,
  drawControlPoint,
  drawCrossMarker,
  drawEngineVisual,
  drawLaunchBayPortVisual,
  drawRadiusField,
  drawWeaponSlotVisual,
  drawWeaponSpriteLayer,
  drawXMarker,
} from './canvas-visuals';

interface RecordedOp {
  op: string;
  alpha: number;
  args: unknown[];
}

interface Recorder {
  ctx: CanvasRenderingContext2D;
  ops: RecordedOp[];
  calls(op: string): RecordedOp[];
}

function createRecorder(): Recorder {
  const ops: RecordedOp[] = [];
  const record = (op: string, args: unknown[] = []) => ops.push({ op, alpha: ctx.globalAlpha, args });
  const ctx = {
    save: () => record('save'),
    restore: () => record('restore'),
    beginPath: () => record('beginPath'),
    closePath: () => record('closePath'),
    stroke: () => record('stroke'),
    fill: () => record('fill', [ctx.fillStyle]),
    arc: (...args: unknown[]) => record('arc', args),
    rect: (...args: unknown[]) => record('rect', args),
    moveTo: (...args: unknown[]) => record('moveTo', args),
    lineTo: (...args: unknown[]) => record('lineTo', args),
    translate: (...args: unknown[]) => record('translate', args),
    rotate: (...args: unknown[]) => record('rotate', args),
    quadraticCurveTo: () => record('quadraticCurveTo'),
    fillText: (...args: unknown[]) => record('fillText', args),
    strokeText: (...args: unknown[]) => record('strokeText', args),
    fillRect: () => record('fillRect'),
    drawImage: (...args: unknown[]) => record('drawImage', args),
    setLineDash: () => record('setLineDash'),
    createLinearGradient: (...args: unknown[]) => {
      record('createLinearGradient', args);
      return { addColorStop: () => record('addColorStop') };
    },
    canvas: { width: 200, height: 200 },
    globalAlpha: 1,
    imageSmoothingEnabled: false,
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineJoin: '',
    lineCap: '',
    font: '',
    textAlign: '',
    textBaseline: '',
  } as unknown as CanvasRenderingContext2D;
  return { ctx, ops, calls: (op) => ops.filter((entry) => entry.op === op) };
}

const point: Point = { x: 10, y: 20 };

describe('drawWeaponSlotVisual', () => {
  it('draws the slot center at full alpha when selected', () => {
    const recorder = createRecorder();
    drawWeaponSlotVisual(recorder.ctx, { angle: 0, arc: 120, mount: 'TURRET', point, selected: true, size: 'MEDIUM', type: 'BALLISTIC' });
    const fills = recorder.calls('fill');
    expect(fills.length).toBeGreaterThan(0);
    expect(fills.at(-1)!.alpha).toBe(1);
    expect(recorder.calls('translate')[0]!.args).toEqual([point.x, point.y]);
  });

  it('renders unselected slots dimmed', () => {
    const recorder = createRecorder();
    drawWeaponSlotVisual(recorder.ctx, { angle: 0, arc: 120, mount: 'TURRET', point, selected: false, size: 'SMALL', type: 'ENERGY' });
    expect(recorder.calls('stroke').every((entry) => entry.alpha === 0.6)).toBe(true);
  });

  it('skips the facing arc for launch bays but keeps the hash outline', () => {
    const recorder = createRecorder();
    drawWeaponSlotVisual(recorder.ctx, { angle: 0, arc: 360, mount: 'HIDDEN', point, selected: false, size: 'LARGE', type: 'LAUNCH_BAY' });
    expect(recorder.calls('rotate')).toHaveLength(0);
    expect(recorder.calls('stroke').length).toBeGreaterThan(0);
  });

  it('uses the fallback color for unknown slot types', () => {
    const recorder = createRecorder();
    drawWeaponSlotVisual(recorder.ctx, { angle: 0, arc: 0, mount: 'TURRET', point, selected: true, size: 'MEDIUM', type: 'MYSTERY' });
    const fills = recorder.calls('fill');
    expect(fills.at(-1)!.args[0]).toBe('#9ca3af');
  });
});

describe('drawBoundsVisual', () => {
  it('draws nothing for fewer than two points', () => {
    const recorder = createRecorder();
    drawBoundsVisual(recorder.ctx, [point], 0, null);
    expect(recorder.calls('stroke')).toHaveLength(0);
  });

  it('closes the polygon and marks every control point', () => {
    const recorder = createRecorder();
    const points = [point, { x: 30, y: 20 }, { x: 30, y: 60 }];
    drawBoundsVisual(recorder.ctx, points, 1, 2);
    expect(recorder.calls('closePath')).toHaveLength(1);
    expect(recorder.calls('arc').length).toBe(3);
  });
});

describe('markers and control points', () => {
  it('skips radius fill for zero radius but keeps the marker', () => {
    const recorder = createRecorder();
    drawRadiusField(recorder.ctx, point, 0, 'rgba(0,0,0,1)', true);
    expect(recorder.calls('fill')).toHaveLength(0);
    expect(recorder.calls('moveTo').length).toBeGreaterThan(0);
  });

  it('fills the radius circle when positive', () => {
    const recorder = createRecorder();
    drawRadiusField(recorder.ctx, point, 50, 'rgba(1,2,3,1)', false);
    expect(recorder.calls('fill')).toHaveLength(1);
    expect(recorder.calls('fill')[0]!.args[0]).toBe('rgba(1,2,3,1)');
  });

  it('draws the cross marker as plus lines and the x marker as diagonals', () => {
    const cross = createRecorder();
    drawCrossMarker(cross.ctx, point, false);
    expect(cross.calls('moveTo')).toHaveLength(2);
    const x = createRecorder();
    drawXMarker(x.ctx, point, false);
    expect(x.calls('moveTo')).toHaveLength(2);
  });

  it('outlines selected control points with a stroke ring', () => {
    const recorder = createRecorder();
    drawControlPoint(recorder.ctx, point, true);
    expect(recorder.calls('fill')).toHaveLength(1);
    expect(recorder.calls('stroke')).toHaveLength(1);
  });
});

describe('drawLaunchBayPortVisual', () => {
  it('draws the larger accent dot for the active port', () => {
    const recorder = createRecorder();
    drawLaunchBayPortVisual(recorder.ctx, { point, selected: true, accent: true });
    expect(recorder.calls('fill')).toHaveLength(1);
    expect(recorder.calls('arc')[0]!.args[2]).toBe(4.5);
    expect(recorder.calls('stroke')).toHaveLength(1);
  });

  it('draws the small dot and ring for passive ports', () => {
    const recorder = createRecorder();
    drawLaunchBayPortVisual(recorder.ctx, { point });
    expect(recorder.calls('fill')).toHaveLength(1);
    expect(recorder.calls('arc')[0]!.args[2]).toBe(2.2);
    expect(recorder.calls('stroke')).toHaveLength(1);
  });
});

describe('drawEngineVisual', () => {
  it('fills the engine body rectangle and a gradient flame', () => {
    const recorder = createRecorder();
    drawEngineVisual(recorder.ctx, { angle: 180, length: 30, point, scale: 1, selected: false, width: 10 });
    expect(recorder.calls('fillRect')).toHaveLength(1);
    expect(recorder.calls('createLinearGradient')[0]!.args).toEqual([0, 0, 30, 0]);
    expect(recorder.calls('addColorStop')).toHaveLength(3);
  });

  it('clamps tiny engines to the minimum body size', () => {
    const recorder = createRecorder();
    drawEngineVisual(recorder.ctx, { angle: 0, length: 1, point, scale: 1, selected: false, width: 1 });
    expect(recorder.calls('createLinearGradient')[0]!.args).toEqual([0, 0, 8, 0]);
  });
});

describe('sprite and barrel layers', () => {
  it('skips the sprite layer when the image has no width', () => {
    const recorder = createRecorder();
    drawWeaponSpriteLayer(recorder.ctx, { width: 0, height: 0 } as HTMLImageElement, { x: 0.5, y: 0.5 }, 1, 0, 0);
    expect(recorder.calls('drawImage')).toHaveLength(0);
  });

  it('draws the sprite pixelated around the origin ratio', () => {
    const recorder = createRecorder();
    drawWeaponSpriteLayer(recorder.ctx, { width: 100, height: 50 } as HTMLImageElement, { x: 0.5, y: 0.25 }, 2, 0, 0);
    expect(recorder.calls('drawImage')).toHaveLength(1);
    expect(recorder.calls('drawImage')[0]!.args.slice(-4)).toEqual([-100, -25, 200, 100]);
    expect(recorder.calls('rotate')[0]!.args[0]).toBeCloseTo(Math.PI / 2);
  });

  it('labels barrels with their index', () => {
    const recorder = createRecorder();
    drawBarrelVisual(recorder.ctx, { angle: 90, index: 3, point, selected: true });
    expect(recorder.calls('fillText')[0]!.args[0]).toBe('3');
    expect(recorder.calls('strokeText')[0]!.args[0]).toBe('3');
  });
});
