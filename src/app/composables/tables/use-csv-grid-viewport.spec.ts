import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { useCsvGridViewport } from './use-csv-grid-viewport';

function items(count: number) {
  return Array.from({ length: count }, (_, index) => index);
}

describe('useCsvGridViewport', () => {
  it('renders only the overscan window before scroll metrics arrive', () => {
    const viewport = useCsvGridViewport(ref(items(100)), { editingIndex: ref(null) });
    expect(viewport.startIndex.value).toBe(0);
    expect(viewport.endIndex.value).toBe(12);
    expect(viewport.visibleItems.value).toHaveLength(12);
    expect(viewport.beforeHeight.value).toBe(0);
    expect(viewport.afterHeight.value).toBe((100 - 12) * 24);
  });

  it('windows the visible items with overscan around the scroll position', () => {
    const viewport = useCsvGridViewport(ref(items(1000)), { editingIndex: ref(null) });
    viewport.setViewportMetrics({ clientHeight: 240, scrollTop: 480 });
    expect(viewport.startIndex.value).toBe(8);
    expect(viewport.endIndex.value).toBe(42);
    expect(viewport.visibleItems.value).toHaveLength(34);
    expect(viewport.beforeHeight.value).toBe(8 * 24);
    expect(viewport.afterHeight.value).toBe((1000 - 42) * 24);
  });

  it('clamps the window to the item bounds', () => {
    const viewport = useCsvGridViewport(ref(items(20)), { editingIndex: ref(null) });
    viewport.setViewportMetrics({ clientHeight: 240, scrollTop: 480 });
    expect(viewport.endIndex.value).toBe(20);
    expect(viewport.afterHeight.value).toBe(0);
    expect(viewport.visibleItems.value.at(-1)).toBe(19);
  });

  it('keeps the editing row inside the rendered window', () => {
    const itemsRef = ref(items(1000));
    const editingIndex = ref<number | null>(200);
    const viewport = useCsvGridViewport(itemsRef, { editingIndex });
    viewport.setViewportMetrics({ clientHeight: 240, scrollTop: 0 });
    expect(viewport.startIndex.value).toBe(0);
    expect(viewport.endIndex.value).toBe(201);
    expect(viewport.visibleItems.value.some((item) => item === 200)).toBe(true);

    editingIndex.value = 0;
    expect(viewport.startIndex.value).toBe(0);

    editingIndex.value = 900;
    expect(viewport.startIndex.value).toBe(0);
    expect(viewport.endIndex.value).toBe(901);
  });

  it('reads scroll metrics from the scroll event target', () => {
    const viewport = useCsvGridViewport(ref(items(100)), { editingIndex: ref(null) });
    const event = { currentTarget: { clientHeight: 300, scrollTop: 96 } } as unknown as Event;
    viewport.onScroll(event);
    expect(viewport.startIndex.value).toBe(0);
    expect(viewport.endIndex.value).toBe(29);
  });

  it('accepts custom row height and overscan', () => {
    const viewport = useCsvGridViewport(ref(items(100)), { editingIndex: ref(null), rowHeight: 10, overscan: 0 });
    viewport.setViewportMetrics({ clientHeight: 50, scrollTop: 50 });
    expect(viewport.startIndex.value).toBe(5);
    expect(viewport.endIndex.value).toBe(10);
    expect(viewport.beforeHeight.value).toBe(50);
  });
});
