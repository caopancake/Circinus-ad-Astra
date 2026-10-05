/// Installs a recording 2D context on HTMLCanvasElement so canvas-backed
/// components can mount under jsdom (which has no canvas implementation).
export function installCanvas2DStub(): void {
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  const noopContext = new Proxy(
    {
      canvas: { width: 300, height: 150 },
      createLinearGradient: () => ({ addColorStop: () => {} }),
      measureText: () => ({ width: 0 }),
    },
    {
      get(target, property) {
        if (property in target) return target[property as keyof typeof target];
        return () => {};
      },
      set() {
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;

  HTMLCanvasElement.prototype.getContext = (() => noopContext) as unknown as HTMLCanvasElement['getContext'];
}
import { vi } from 'vitest';
