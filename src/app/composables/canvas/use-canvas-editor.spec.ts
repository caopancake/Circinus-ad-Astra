import { mount } from '@vue/test-utils';
import { defineComponent, h, ref, shallowRef } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { createCanvasEditorState, useCanvasEditor, type CanvasEditorHooks } from './use-canvas-editor';
import { useCanvasViewport } from './use-canvas-viewport';
import type { RowData } from '@/shared/types';
import { installCanvas2DStub } from '@/test/canvas-stub';

function mountCanvas() {
  installCanvas2DStub();
  const value = ref<RowData>({ x: 0 });
  const onDraftMutated = vi.fn();
  const target = { kind: 'slot', i: 0, distance: 0 };
  const hooks: CanvasEditorHooks<null> = {
    value,
    onDraftMutated,
    normalize: (next) => next,
    deleteSelected: () => false,
    shortcutKeys: {},
    inspectorReveal: () => null,
    selectableTargets: () => [target],
    hitRadius: () => 5,
    actionDown: () => null,
    selectForDown: () => target,
    resolveDragKind: () => 'slot',
    captureMirrorPair: () => {},
    applyDrag: (_kind, x) => {
      value.value.x = x;
    },
    applyMirrorDrag: () => {},
    previewTakesOver: () => false,
    computePreview: () => null,
    drawPreview: () => {},
    cursorMarker: () => null,
    mirrorAxisCanvasY: () => 0,
    draw: () => {},
  };
  const wrapper = mount(
    defineComponent({
      setup() {
        const editor = useCanvasEditor({
          stageRef: shallowRef(null),
          windowRef: shallowRef(null),
          expandedSections: ref([]),
          viewport: useCanvasViewport(shallowRef(null), 1, 10),
          state: createCanvasEditorState<null>(),
          hooks,
        });
        return () =>
          h('canvas', { onMousedown: editor.onDown, onMousemove: editor.onMove, onMouseup: editor.onUp, onMouseleave: editor.onLeave });
      },
    }),
  );
  return { wrapper, onDraftMutated };
}

describe('canvas pointer completion', () => {
  it.each(['mouseup', 'mouseleave'])('commits a drag once on %s', async (boundary) => {
    const { wrapper, onDraftMutated } = mountCanvas();
    const canvas = wrapper.find('canvas');
    await canvas.trigger('mousedown', { button: 0, offsetX: 0, offsetY: 0 });
    await canvas.trigger('mousemove', { clientX: 10, clientY: 0 });
    expect(onDraftMutated).not.toHaveBeenCalled();
    await canvas.trigger(boundary);
    expect(onDraftMutated).toHaveBeenCalledExactlyOnceWith({ x: 10 });
    await canvas.trigger('mouseup');
    await canvas.trigger('mouseleave');
    expect(onDraftMutated).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('keeps view-only panning outside the draft history', async () => {
    const { wrapper, onDraftMutated } = mountCanvas();
    const canvas = wrapper.find('canvas');
    await canvas.trigger('mousedown', { button: 2 });
    await canvas.trigger('mousemove', { offsetX: 10, offsetY: 0 });
    await canvas.trigger('mouseleave');
    expect(onDraftMutated).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
