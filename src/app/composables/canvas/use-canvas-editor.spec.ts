import { createFieldInputs, provideFieldInputs } from '@/shared/runtime/field-inputs';
import { deepClone } from '@/shared/lib/starsector';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref, shallowRef } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { createCanvasEditorState, useCanvasEditor, type CanvasEditorHooks } from './use-canvas-editor';
import { useCanvasViewport } from './use-canvas-viewport';
import type { EditContext, RowData } from '@/shared/types';
import { installCanvas2DStub } from '@/test/canvas-stub';

vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: vi.fn() }) }));

function mountCanvas() {
  setActivePinia(createPinia());
  installCanvas2DStub();
  const value = ref<RowData>({ x: 0 });
  const source = ref<RowData>({ x: 0 });
  const context = ref<EditContext | null>({ targetKey: 'one', baselineGeneration: 1, handoff: 'load' });
  const inputs = createFieldInputs(ref('one'));
  const state = createCanvasEditorState<null>();
  let editor!: ReturnType<typeof useCanvasEditor<null>>;
  const onDraftMutated = vi.fn((draft: RowData) => {
    source.value = deepClone(draft);
  });
  const target = { kind: 'slot', i: 0, distance: 0 };
  const hooks: CanvasEditorHooks<null> = {
    value,
    sourceValue: () => source.value,
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
    applyMirrorDrag: () => {
      if (state.mirrorMode.value) value.value.y = -(value.value.x as number);
    },
    previewTakesOver: () => false,
    computePreview: () => null,
    drawPreview: () => {},
    cursorMarker: () => null,
    mirrorAxisCanvasY: () => 0,
    draw: () => {},
  };
  const surface = defineComponent({
    setup() {
      editor = useCanvasEditor({
        context,
        stageRef: shallowRef(null),
        windowRef: shallowRef(null),
        expandedSections: ref([]),
        viewport: useCanvasViewport(shallowRef(null), 1, 10),
        state,
        hooks,
      });
      return () =>
        h('section', [
          h('input', {
            value: value.value.x,
            onFocusin: editor.beginField,
            onFocusout: editor.fieldBlur,
            onKeyup: editor.fieldKey,
            onInput: (event: Event) => {
              value.value.x = Number((event.target as HTMLInputElement).value);
              editor.commitEdit();
            },
          }),
          h('canvas', { onMousedown: editor.onDown, onMousemove: editor.onMove, onMouseup: editor.onUp, onMouseleave: editor.onLeave }),
        ]);
    },
  });
  const wrapper = mount(
    {
      setup() {
        provideFieldInputs(inputs);
        return () => h(surface);
      },
    },
    { attachTo: document.body },
  );
  return { wrapper, onDraftMutated, value, source, context, inputs, state, editor };
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

describe('canvas action and history lifecycle', () => {
  it('keeps pending input attached to its selection while the pointer moves', async () => {
    const { wrapper, inputs, state } = mountCanvas();
    const pending = ref(true);
    inputs.register({ key: 'number', label: 'Number', dirty: pending, commit: () => 'Incomplete', cancel: () => {}, focus: () => {} });
    state.selected.value = 1;
    await wrapper.get('canvas').trigger('mousemove', { clientX: 5 });
    expect(state.selected.value).toBe(1);
    pending.value = false;
    await wrapper.get('canvas').trigger('mousemove', { clientX: 5 });
    expect(state.selected.value).toBe(0);
    wrapper.unmount();
  });
  it('preserves asynchronous action acceptance across saving and revokes it on baseline handoff and release', async () => {
    const { wrapper, editor, context } = mountCanvas();
    const accepts = editor.captureActionContext();
    context.value = { targetKey: 'renamed', baselineGeneration: 2, handoff: 'save' };
    await nextTick();
    expect(accepts()).toBe(true);
    context.value = { targetKey: 'renamed', baselineGeneration: 3, handoff: 'external' };
    await nextTick();
    expect(accepts()).toBe(false);
    const current = editor.captureActionContext();
    wrapper.unmount();
    expect(current()).toBe(false);
  });
  it('groups continuous inspector typing, alternates with pointer history and retains history after local save', async () => {
    const { wrapper, editor, value, context } = mountCanvas();
    const input = wrapper.get('input');
    input.element.focus();
    await input.setValue('1');
    await input.setValue('2');
    await input.trigger('keyup', { key: 'Enter' });
    expect(value.value.x).toBe(2);
    input.element.blur();
    const canvas = wrapper.get('canvas');
    await canvas.trigger('mousedown', { button: 0, clientX: 3 });
    await canvas.trigger('mouseup');
    await nextTick();
    expect(value.value.x).toBe(3);
    context.value = { targetKey: 'one', baselineGeneration: 2, handoff: 'save' };
    await nextTick();
    editor.doUndo();
    expect(value.value.x).toBe(2);
    editor.doUndo();
    expect(value.value.x).toBe(0);
    editor.doRedo();
    expect(value.value.x).toBe(2);
    wrapper.unmount();
  });
  it('finishes dragging at save capture and records mirror mutation once', async () => {
    const { wrapper, editor, value, inputs, state } = mountCanvas();
    state.mirrorMode.value = true;
    const canvas = wrapper.get('canvas');
    await canvas.trigger('mousedown', { button: 0, clientX: 5 });
    await nextTick();
    expect(state.dragKind.value).toBe('slot');
    await inputs.commit();
    const submitted = deepClone(value.value);
    expect(submitted.x).toBe(5);
    expect(submitted.y).toBe(-5);
    expect(state.dragKind.value).toBeNull();
    await canvas.trigger('mousemove', { offsetX: 8 });
    await canvas.trigger('mouseup');
    editor.doUndo();
    expect(value.value.x).toBe(0);
    editor.doRedo();
    expect(value.value.x).toBe(5);
    wrapper.unmount();
  });
  it('validates pending raw input before an action finalizer records history', async () => {
    const { wrapper, editor, value, inputs } = mountCanvas();
    const input = wrapper.get('input');
    input.element.focus();
    await input.setValue('2');
    const pending = ref(true);
    const release = inputs.register({
      key: 'raw',
      label: 'Raw',
      dirty: pending,
      commit: () => 'Incomplete',
      cancel: () => {},
      focus: () => {},
    });
    await expect(inputs.commit()).rejects.toMatchObject({ action: 'commit-field-inputs' });
    release();
    await inputs.commit();
    editor.doUndo();
    expect(value.value.x).toBe(0);
    wrapper.unmount();
  });
  it('clears selection, preview and both history stacks on an external baseline', async () => {
    const { wrapper, editor, value, source, context, state } = mountCanvas();
    editor.beginEdit();
    value.value.x = 5;
    editor.commitEdit();
    state.selected.value = 0;
    source.value = { x: 90 };
    context.value = { targetKey: 'one', baselineGeneration: 2, handoff: 'external' };
    await nextTick();
    expect(value.value.x).toBe(90);
    expect(state.selected.value).toBeNull();
    expect(state.dragKind.value).toBeNull();
    editor.doUndo();
    editor.doRedo();
    expect(value.value.x).toBe(90);
    wrapper.unmount();
  });
  it('completes a short pointer action released while inputs are committing', async () => {
    const { wrapper, value, inputs, editor, onDraftMutated } = mountCanvas();
    const raw = ref(true);
    inputs.register({
      key: 'raw',
      label: 'Raw',
      dirty: raw,
      commit: () => {
        raw.value = false;
        return null;
      },
      cancel: () => {},
      focus: () => {},
    });
    const canvas = wrapper.get('canvas');
    canvas.element.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 4 }));
    canvas.element.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    await nextTick();
    await nextTick();
    await nextTick();
    expect(value.value.x).toBe(4);
    expect(onDraftMutated).toHaveBeenCalledOnce();
    editor.doUndo();
    expect(value.value.x).toBe(0);
    wrapper.unmount();
  });
});
