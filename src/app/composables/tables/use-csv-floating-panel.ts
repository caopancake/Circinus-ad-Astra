import { computed, onScopeDispose, ref } from 'vue';

export interface CsvFloatingAnchor {
  height: number;
  left: number;
  top: number;
  width: number;
}

export function useCsvFloatingPanel(anchor: () => CsvFloatingAnchor, height: number) {
  const viewport = ref({ width: window.innerWidth, height: window.innerHeight });
  const resized = () => {
    viewport.value = { width: window.innerWidth, height: window.innerHeight };
  };
  window.addEventListener('resize', resized);
  onScopeDispose(() => window.removeEventListener('resize', resized));
  return computed(() => {
    const rect = anchor();
    const width = Math.min(Math.max(rect.width, 300), 600, viewport.value.width - 8);
    const left = Math.max(4, Math.min(rect.left, viewport.value.width - width - 4));
    const top = rect.top + rect.height + 2;
    const spaceBelow = viewport.value.height - top;
    const flipUp = spaceBelow < height && rect.top - 2 > spaceBelow;
    return {
      bottom: flipUp ? `${viewport.value.height - rect.top + 2}px` : undefined,
      left: `${left}px`,
      top: flipUp ? undefined : `${top}px`,
      width: `${width}px`,
    };
  });
}
