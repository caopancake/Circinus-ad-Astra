import type { Ref } from 'vue';

interface CanvasSize {
  width: number;
  height: number;
}

export function useCanvasSurface(canvasRef: Readonly<Ref<HTMLCanvasElement | null | undefined>>) {
  let dimensions: CanvasSize | null = null;

  function size(): CanvasSize {
    if (dimensions) return dimensions;
    const rect = canvasRef.value?.getBoundingClientRect();
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
  }

  function resize(width?: number, height?: number) {
    const canvas = canvasRef.value;
    if (!canvas) return false;
    const rect = canvas.getBoundingClientRect();
    dimensions = { width: Math.max(1, width ?? rect.width), height: Math.max(1, height ?? rect.height) };
    canvas.width = Math.round(dimensions.width * window.devicePixelRatio);
    canvas.height = Math.round(dimensions.height * window.devicePixelRatio);
    const ctx = canvas.getContext('2d');
    ctx?.setTransform(canvas.width / dimensions.width, 0, 0, canvas.height / dimensions.height, 0, 0);
    return true;
  }

  return { resize, size };
}

export function watchCanvasPixelRatio(onChange: () => void): () => void {
  let query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);

  function changed() {
    query.removeEventListener('change', changed);
    query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener('change', changed);
    onChange();
  }

  query.addEventListener('change', changed);
  return () => query.removeEventListener('change', changed);
}
