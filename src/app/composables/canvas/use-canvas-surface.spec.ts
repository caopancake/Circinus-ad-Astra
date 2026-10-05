import { afterEach, describe, expect, it, vi } from 'vitest';
import { shallowRef } from 'vue';
import { useCanvasSurface, watchCanvasPixelRatio } from './use-canvas-surface';

describe('canvas surface resolution', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps fractional layout sizes exactly into rounded physical pixels on every resize', () => {
    vi.stubGlobal('devicePixelRatio', 1.5);
    const setTransform = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getBoundingClientRect: () => ({ width: 401.5, height: 201.25 }),
      getContext: () => ({ setTransform }),
    } as unknown as HTMLCanvasElement;
    const surface = useCanvasSurface(shallowRef(canvas));
    surface.resize();
    expect(canvas.width).toBe(602);
    expect(canvas.height).toBe(302);
    expect(surface.size()).toEqual({ width: 401.5, height: 201.25 });
    expect(setTransform).toHaveBeenLastCalledWith(602 / 401.5, 0, 0, 302 / 201.25, 0, 0);
    vi.stubGlobal('devicePixelRatio', 2);
    surface.resize();
    expect(canvas.width).toBe(803);
    expect(setTransform).toHaveBeenLastCalledWith(2, 0, 0, 403 / 201.25, 0, 0);
  });

  it('rearms the resolution subscription after DPI changes and releases the active listener', () => {
    const queries: Array<{ media: string; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> }> = [];
    vi.stubGlobal(
      'matchMedia',
      vi.fn((media: string) => {
        const query = { media, addEventListener: vi.fn(), removeEventListener: vi.fn() };
        queries.push(query);
        return query;
      }),
    );
    vi.stubGlobal('devicePixelRatio', 1.25);
    const redraw = vi.fn();
    const stop = watchCanvasPixelRatio(redraw);
    expect(queries[0]!.media).toBe('(resolution: 1.25dppx)');
    const listener = queries[0]!.addEventListener.mock.calls[0]![1] as () => void;
    vi.stubGlobal('devicePixelRatio', 2);
    listener();
    expect(queries[0]!.removeEventListener).toHaveBeenCalledWith('change', listener);
    expect(queries[1]!.media).toBe('(resolution: 2dppx)');
    expect(redraw).toHaveBeenCalledOnce();
    stop();
    expect(queries[1]!.removeEventListener).toHaveBeenCalledWith('change', listener);
  });
});
