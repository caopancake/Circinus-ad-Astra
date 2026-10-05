import { afterEach, describe, expect, it, vi } from 'vitest';
import { ref, shallowRef } from 'vue';
import { useCanvasViewport } from './use-canvas-viewport';

function fakeCanvas(width = 400, height = 200): HTMLCanvasElement {
  return {
    width,
    height,
    getBoundingClientRect: () => ({ width, height, top: 0, left: 0 }) as DOMRect,
    getContext: () => null,
  } as unknown as HTMLCanvasElement;
}

describe('useCanvasViewport', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('centers on the canvas midpoint plus pan', () => {
    const canvas = shallowRef(fakeCanvas());
    const viewport = useCanvasViewport(canvas, 1, 10);
    expect(viewport.center()).toEqual({ x: 200, y: 100 });
    viewport.panBy(10, -20);
    expect(viewport.center()).toEqual({ x: 210, y: 80 });
  });

  it('falls back to the pan offset without a canvas', () => {
    const canvas = shallowRef<HTMLCanvasElement | null>(null);
    const viewport = useCanvasViewport(canvas, 1, 10);
    expect(viewport.center()).toEqual({ x: 0, y: 0 });
  });

  it('resizes the canvas and establishes CSS pixel coordinates', () => {
    const setTransform = vi.fn();
    const target = {
      width: 400,
      height: 200,
      getBoundingClientRect: () => ({ width: 400, height: 200, top: 0, left: 0 }) as DOMRect,
      getContext: () => ({ setTransform }),
    } as unknown as HTMLCanvasElement;
    const canvas = shallowRef(target);
    const viewport = useCanvasViewport(canvas, 1, 10);
    expect(viewport.resize(640, 480)).toBe(true);
    expect(target.width).toBe(640);
    expect(target.height).toBe(480);
    expect(setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);
  });

  it.each([1, 1.25, 1.5, 2])('keeps coordinate round trips and pan in CSS pixels at DPR %s', (ratio) => {
    vi.stubGlobal('devicePixelRatio', ratio);
    const canvas = fakeCanvas();
    const viewport = useCanvasViewport(shallowRef(canvas), 2, 10);
    viewport.resize(640, 480);
    viewport.panBy(10, -20);
    expect(canvas.width).toBe(640 * ratio);
    expect(canvas.height).toBe(480 * ratio);
    expect(viewport.center()).toEqual({ x: 330, y: 220 });
    expect(viewport.toCanvas('ship', 10, 5)).toEqual({ x: 350, y: 210 });
    expect(viewport.fromCanvas('ship', 350, 210)).toEqual({ x: 10, y: 5 });
    expect(viewport.toCanvas('weapon', 10, 5)).toEqual({ x: 340, y: 200 });
    expect(viewport.fromCanvas('weapon', 340, 200)).toEqual({ x: 10, y: 5 });
  });

  it('clamps zoom into 0.1..maxScale', () => {
    const viewport = useCanvasViewport(shallowRef(fakeCanvas()), 1, 10);
    for (let index = 0; index < 50; index += 1) viewport.zoom(100);
    expect(viewport.scale.value).toBeCloseTo(0.1);
    for (let index = 0; index < 100; index += 1) viewport.zoom(-100);
    expect(viewport.scale.value).toBe(10);
  });

  it('zooms in on negative wheel deltas and out on positive ones', () => {
    const viewport = useCanvasViewport(shallowRef(fakeCanvas()), 1, 10);
    viewport.zoom(-100);
    expect(viewport.scale.value).toBeCloseTo(1.1);
    viewport.zoom(100);
    expect(viewport.scale.value).toBeCloseTo(0.99);
  });

  it('converts ship coordinates with the flipped y axis', () => {
    const viewport = useCanvasViewport(shallowRef(fakeCanvas()), 2, 10);
    expect(viewport.toCanvas('ship', 10, 5)).toEqual({ x: 220, y: 90 });
    expect(viewport.fromCanvas('ship', 220, 90)).toEqual({ x: 10, y: 5 });
  });

  it('converts weapon coordinates with swapped axes', () => {
    const viewport = useCanvasViewport(shallowRef(fakeCanvas()), 2, 10);
    expect(viewport.toCanvas('weapon', 10, 5)).toEqual({ x: 210, y: 80 });
    expect(viewport.fromCanvas('weapon', 210, 80)).toEqual({ x: 10, y: 5 });
  });

  it('keeps reactive pan values readable through the exposed ref', () => {
    const viewport = useCanvasViewport(shallowRef(fakeCanvas()), 1, 10);
    expect(viewport.pan).toBeInstanceOf(ref(0).constructor);
    viewport.panBy(5, 5);
    expect(viewport.pan.value).toEqual({ x: 5, y: 5 });
  });
});
