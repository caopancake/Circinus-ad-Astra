import { computed, nextTick, onMounted, onScopeDispose, onUnmounted, ref, shallowRef, watch, type Ref, type ShallowRef } from 'vue';
import type { Point } from '@/domain/editors/editor-types';
import type { EditContext, RowData } from '@/shared/types';
import { useSnapshotHistory } from '@/app/composables/use-snapshot-history';
import { useFieldInputActions } from '@/app/composables/use-field-input-actions';
import { useEditActionContext } from '@/app/composables/use-edit-action-context';
import { deepClone } from '@/shared/lib/starsector';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import { registerFieldInput, useFieldInputs } from '@/shared/runtime/field-inputs';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useCanvasDrawing } from '@/app/composables/canvas/use-canvas-drawing';
import { watchCanvasPixelRatio } from '@/app/composables/canvas/use-canvas-surface';
import type { CanvasViewport } from '@/app/composables/canvas/use-canvas-viewport';
import { useShortcutDispatch } from '@/app/composables/use-shortcut-dispatch';
import {
  CANVAS_HANDLE_COLOR,
  CANVAS_HIGHLIGHT_COLOR,
  CANVAS_HIGHLIGHT_FILL_COLOR,
  CANVAS_SHADOW_COLOR,
} from '@/domain/editors/lib/canvas-palette';

export interface CanvasTarget {
  kind: string;
  i: number;
  distance: number;
  /// Sub-index within the target (launch bay port); optional so existing
  /// editors stay untouched.
  port?: number;
}

export type CanvasTargetIdentity = { kind: string; i: number; port?: number };

export type CanvasModifiers = Pick<MouseEvent | KeyboardEvent, 'altKey' | 'ctrlKey' | 'shiftKey'>;

export interface CanvasPick {
  byIdentity(identity: CanvasTargetIdentity | null): CanvasTarget | null;
  byPointer(mx: number, my: number): CanvasTarget | null;
}

export interface CanvasInspectorReveal {
  section: string;
  selector: string;
  lock: CanvasTargetIdentity | null;
}

export interface CanvasEditorState<TPreview> {
  activeTarget: Ref<CanvasTargetIdentity | null>;
  clearPreview(): void;
  dragKind: Ref<string | null>;
  hoverPreview: Ref<TPreview | null>;
  hovered: Ref<CanvasTargetIdentity | null>;
  inspectorLock: Ref<CanvasTargetIdentity | null>;
  mirrorMode: Ref<boolean>;
  mirrorPair: Ref<CanvasTargetIdentity | null>;
  selected: Ref<number | null>;
  setPreview(preview: TPreview | null): void;
}

export function createCanvasEditorState<TPreview>(): CanvasEditorState<TPreview> {
  const hovered = ref<CanvasTargetIdentity | null>(null);
  const selected = ref<number | null>(null);
  const activeTarget = ref<CanvasTargetIdentity | null>(null);
  const inspectorLock = ref<CanvasTargetIdentity | null>(null);
  const mirrorMode = ref(false);
  const mirrorPair = ref<CanvasTargetIdentity | null>(null);
  const hoverPreview = ref(null) as Ref<TPreview | null>;
  const dragKind = ref<string | null>(null);
  return {
    activeTarget,
    clearPreview: () => {
      hoverPreview.value = null;
    },
    dragKind,
    hoverPreview,
    hovered,
    inspectorLock,
    mirrorMode,
    mirrorPair,
    selected,
    setPreview: (preview) => {
      hoverPreview.value = preview;
    },
  };
}

export interface CanvasEditorHooks<TPreview> {
  value: Ref<RowData>;
  onDraftMutated(value: RowData): void;
  normalize(value: RowData): RowData;
  sourceValue(): RowData;
  deleteSelected(): boolean;
  shortcutKeys: Record<string, () => void>;
  inspectorReveal(): CanvasInspectorReveal | null;
  selectableTargets(mx: number, my: number): CanvasTarget[];
  hitRadius(target: CanvasTarget): number;
  actionDown(e: MouseEvent, mx: number, my: number): string | null;
  selectForDown(e: MouseEvent, mx: number, my: number, pick: CanvasPick): CanvasTarget | null;
  resolveDragKind(e: MouseEvent, mx: number, my: number, target: CanvasTarget, selectedAtDown: number | null): string | null;
  captureMirrorPair(): void;
  applyDrag(kind: string, mx: number, my: number, e: MouseEvent): void;
  applyMirrorDrag(kind: string): void;
  previewTakesOver(e: MouseEvent): boolean;
  computePreview(mx: number, my: number, modifiers: CanvasModifiers): TPreview | null;
  drawPreview(ctx: CanvasRenderingContext2D, preview: TPreview): void;
  cursorMarker(mx: number, my: number): { point: Point; label: string } | null;
  mirrorAxisCanvasY(): number;
  onReady?(): void;
  draw(): void;
}

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt']);

export function useCanvasEditor<TPreview>(options: {
  context: Readonly<Ref<EditContext | null>>;
  stageRef: Readonly<ShallowRef<HTMLElement | null>>;
  windowRef: Readonly<ShallowRef<HTMLElement | null>>;
  expandedSections: Ref<string[]>;
  viewport: CanvasViewport;
  state: CanvasEditorState<TPreview>;
  hooks: CanvasEditorHooks<TPreview>;
}) {
  const { stageRef, windowRef, expandedSections, viewport, state, hooks } = options;
  const { scale } = viewport;
  const drawing = useCanvasDrawing();
  const history = useSnapshotHistory<RowData>(options.context, 250);
  const inputs = useFieldInputs();
  const { commitBefore: runAction } = useFieldInputActions(inputs);
  const feedback = useAppFeedback();
  const action = shallowRef<{ kind: 'pointer' | 'field' | 'explicit'; before: RowData; element?: HTMLElement } | null>(null);
  let committedValue = deepClone(hooks.value.value);
  let pendingPointer: { event: MouseEvent; latest: MouseEvent; ended: boolean } | null = null;
  const { captureActionContext } = useEditActionContext(options.context);

  function beginAction(kind: 'pointer' | 'field' | 'explicit', element?: HTMLElement) {
    if (action.value) return;
    action.value = { kind, before: deepClone(committedValue), element };
  }
  function finishAction() {
    if (!action.value) return;
    history.push(action.value.before, hooks.value.value);
    action.value = null;
    committedValue = deepClone(hooks.value.value);
  }
  function beginField(event: FocusEvent) {
    const element = event.target as HTMLElement;
    if (!element.matches('input, textarea, select, [contenteditable="true"]')) return;
    if (action.value?.element === element) return;
    finishPointerAction();
    finishAction();
    beginAction('field', element);
  }
  function endField() {
    if (action.value?.kind === 'field') finishAction();
  }
  function fieldBlur() {
    const blurred = action.value;
    void nextTick(() => {
      if (action.value === blurred) endField();
    });
  }
  function fieldKey(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    if ((event.target as HTMLElement).tagName === 'TEXTAREA' && !event.ctrlKey) return;
    endField();
  }
  registerFieldInput({
    key: 'canvas-action',
    label: '画布编辑',
    dirty: computed(() => action.value !== null && !stableDeepEqual(action.value.before, hooks.value.value)),
    commit: () => null,
    focus: () => windowRef.value?.focus(),
    cancel: () => {
      action.value = null;
      pendingPointer = null;
      state.dragKind.value = null;
    },
  });
  if (inputs)
    onScopeDispose(
      inputs.registerFinalizer(() => {
        finishPointerAction();
        finishAction();
      }),
    );
  watch(
    options.context,
    (context) => {
      if (!context || context.handoff !== 'save') {
        action.value = null;
        pendingPointer = null;
        state.dragKind.value = null;
        resetSelection();
        state.mirrorPair.value = null;
        state.clearPreview();
        hooks.value.value = hooks.normalize(hooks.sourceValue());
        committedValue = deepClone(hooks.value.value);
        hooks.draw();
      } else if (!action.value && !inputs?.dirty.value) {
        hooks.value.value = hooks.normalize(hooks.sourceValue());
        committedValue = deepClone(hooks.value.value);
      }
    },
    { flush: 'post' },
  );

  const pointerInside = ref(false);
  const panning = ref(false);
  const revealInProgress = ref(false);

  let last = { x: 0, y: 0 };
  let stopPixelRatio: (() => void) | null = null;

  function drawBase(ctx: CanvasRenderingContext2D) {
    const dimensions = viewport.size();
    const center = viewport.center();
    drawing.clear(ctx, dimensions.width, dimensions.height);
    drawing.drawGrid(ctx, { center, height: dimensions.height, scale: scale.value, width: dimensions.width });
  }

  function drawMirrorAxis(ctx: CanvasRenderingContext2D) {
    const axisY = hooks.mirrorAxisCanvasY();
    ctx.save();
    ctx.strokeStyle = CANVAS_HIGHLIGHT_COLOR;
    ctx.fillStyle = CANVAS_HIGHLIGHT_FILL_COLOR;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(0, axisY);
    ctx.lineTo(viewport.size().width, axisY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '11px sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.fillText('镜像中轴', 8, axisY - 4);
    ctx.restore();
  }

  function drawHoverPreview(ctx: CanvasRenderingContext2D) {
    if (state.hoverPreview.value) hooks.drawPreview(ctx, state.hoverPreview.value);
  }

  function drawCursorPosition(ctx: CanvasRenderingContext2D) {
    if (!pointerInside.value) return;
    const marker = hooks.cursorMarker(last.x, last.y);
    if (!marker) return;
    ctx.save();
    ctx.strokeStyle = CANVAS_HANDLE_COLOR;
    ctx.fillStyle = CANVAS_HANDLE_COLOR;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(marker.point.x - 6, marker.point.y);
    ctx.lineTo(marker.point.x + 6, marker.point.y);
    ctx.moveTo(marker.point.x, marker.point.y - 6);
    ctx.lineTo(marker.point.x, marker.point.y + 6);
    ctx.stroke();
    ctx.font = '11px sans-serif';
    ctx.textBaseline = 'top';
    ctx.strokeStyle = CANVAS_SHADOW_COLOR;
    ctx.lineWidth = 3;
    ctx.strokeText(marker.label, marker.point.x + 12, marker.point.y + 12);
    ctx.fillText(marker.label, marker.point.x + 12, marker.point.y + 12);
    ctx.restore();
  }

  function commitEdit() {
    if (!action.value) {
      const element = document.activeElement as HTMLElement | null;
      beginAction(element?.matches('input, textarea') && windowRef.value?.contains(element) ? 'field' : 'explicit', element ?? undefined);
    }
    hooks.onDraftMutated(hooks.value.value);
    committedValue = deepClone(hooks.value.value);
    if (action.value?.kind === 'explicit') finishAction();
  }

  function beginEdit() {
    endField();
    beginAction('explicit');
  }

  function resetSelection() {
    state.hovered.value = null;
    state.selected.value = null;
    state.activeTarget.value = null;
    state.inspectorLock.value = null;
  }

  function doUndo() {
    finishPointerAction();
    finishAction();
    const previous = history.undo();
    if (!previous) return;
    hooks.value.value = hooks.normalize(previous);
    resetSelection();
    state.clearPreview();
    committedValue = deepClone(hooks.value.value);
    hooks.onDraftMutated(hooks.value.value);
    hooks.draw();
  }

  function doRedo() {
    finishPointerAction();
    finishAction();
    const next = history.redo();
    if (!next) return;
    hooks.value.value = hooks.normalize(next);
    resetSelection();
    state.clearPreview();
    committedValue = deepClone(hooks.value.value);
    hooks.onDraftMutated(hooks.value.value);
    hooks.draw();
  }

  function toggleMirrorMode() {
    state.mirrorMode.value = !state.mirrorMode.value;
    state.mirrorPair.value = null;
    state.clearPreview();
    hooks.draw();
  }

  function targetMatches(target: CanvasTarget | null, identity: CanvasTargetIdentity | null) {
    return Boolean(target && identity && target.kind === identity.kind && target.i === identity.i && target.port === identity.port);
  }

  function nearestTarget(mx: number, my: number) {
    const targets = hooks.selectableTargets(mx, my);
    const locked = targets.find((target) => targetMatches(target, state.inspectorLock.value)) ?? null;
    const nearby =
      targets
        .filter((target) => !targetMatches(target, state.inspectorLock.value) && target.distance <= hooks.hitRadius(target))
        .sort((a, b) => a.distance - b.distance)[0] ?? null;
    if (nearby) return nearby;
    if (locked) return locked;
    if (!state.inspectorLock.value) return targets.sort((a, b) => a.distance - b.distance)[0] ?? null;
    return null;
  }

  function syncSelection(target: CanvasTarget) {
    state.hovered.value = { kind: target.kind, i: target.i, port: target.port };
    state.selected.value = target.i;
    state.activeTarget.value = { kind: target.kind, i: target.i, port: target.port };
  }

  function clearSelection() {
    state.hovered.value = null;
    state.selected.value = null;
    state.activeTarget.value = null;
  }

  function selectIdentityTarget(identity: CanvasTargetIdentity | null) {
    if (!identity) return null;
    const target = hooks.selectableTargets(last.x, last.y).find((item) => targetMatches(item, identity)) ?? null;
    if (target) syncSelection(target);
    return target;
  }

  function selectForPointer(mx: number, my: number) {
    const target = nearestTarget(mx, my);
    if (target) {
      syncSelection(target);
      return target;
    }
    clearSelection();
    return null;
  }

  const pick: CanvasPick = {
    byIdentity: (identity) => selectIdentityTarget(identity),
    byPointer: (mx, my) => selectForPointer(mx, my),
  };

  function onDown(e: MouseEvent) {
    if (e.button === 0 && inputs) {
      const request = { event: e, latest: e, ended: false };
      pendingPointer = request;
      const commit = inputs.commit();
      if (commit) {
        void commit
          .then((accepted) => {
            if (!accepted || pendingPointer !== request) return;
            pendingPointer = null;
            startPointerAction(request.event);
            if (state.dragKind.value) {
              hooks.applyDrag(state.dragKind.value, request.latest.offsetX, request.latest.offsetY, request.latest);
              hooks.applyMirrorDrag(state.dragKind.value);
            }
            if (request.ended) {
              finishPointerAction();
              hooks.draw();
            }
          })
          .catch((error: unknown) => {
            pendingPointer = null;
            feedback.error(error);
          });
        return;
      }
      pendingPointer = null;
    }
    startPointerAction(e);
  }

  function startPointerAction(e: MouseEvent) {
    const mx = e.offsetX;
    const my = e.offsetY;
    last = { x: mx, y: my };
    if (e.button === 2) {
      panning.value = true;
      return;
    }
    if (e.button !== 0) return;
    endField();
    beginAction('pointer');
    const selectedAtDown = state.selected.value;
    const actionKind = hooks.actionDown(e, mx, my);
    if (actionKind !== null) {
      state.dragKind.value = actionKind;
      state.clearPreview();
      hooks.draw();
      return;
    }
    const target = hooks.selectForDown(e, mx, my, pick);
    if (!target) {
      finishAction();
      hooks.draw();
      return;
    }
    const kind = hooks.resolveDragKind(e, mx, my, target, selectedAtDown);
    if (!kind) {
      finishAction();
      hooks.draw();
      return;
    }
    beginEdit();
    state.dragKind.value = kind;
    state.clearPreview();
    hooks.captureMirrorPair();
    hooks.applyDrag(kind, mx, my, e);
    hooks.applyMirrorDrag(kind);
    hooks.draw();
  }

  function onMove(e: MouseEvent) {
    if (pendingPointer) {
      pendingPointer.latest = e;
      return;
    }
    const mx = e.offsetX;
    const my = e.offsetY;
    pointerInside.value = true;
    const dx = mx - last.x;
    const dy = my - last.y;
    last = { x: mx, y: my };
    if (panning.value) {
      viewport.panBy(dx, dy);
      hooks.draw();
      return;
    }
    if (state.dragKind.value) {
      hooks.applyDrag(state.dragKind.value, mx, my, e);
      hooks.applyMirrorDrag(state.dragKind.value);
      hooks.draw();
      return;
    }
    state.setPreview(hooks.computePreview(mx, my, e));
    if (!hooks.previewTakesOver(e) && action.value?.kind !== 'field' && !inputs?.dirty.value) {
      const target = nearestTarget(mx, my);
      if (target) syncSelection(target);
      else clearSelection();
    }
    hooks.draw();
  }

  function finishPointerAction() {
    const wasDragging = state.dragKind.value !== null;
    state.dragKind.value = null;
    panning.value = false;
    state.mirrorPair.value = null;
    state.clearPreview();
    if (wasDragging) commitEdit();
    if (action.value?.kind === 'pointer') finishAction();
  }

  function onUp() {
    if (pendingPointer) pendingPointer.ended = true;
    finishPointerAction();
    hooks.draw();
  }

  function onLeave() {
    if (pendingPointer) pendingPointer.ended = true;
    finishPointerAction();
    pointerInside.value = false;
    state.hovered.value = null;
    state.activeTarget.value = null;
    hooks.draw();
  }

  function onWheel(e: WheelEvent) {
    viewport.zoom(e.deltaY);
    hooks.draw();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!MODIFIER_KEYS.has(event.key)) return;
    if (!pointerInside.value || state.dragKind.value || panning.value) return;
    state.setPreview(hooks.computePreview(last.x, last.y, event));
    if (state.hoverPreview.value) hooks.draw();
  }

  function onKeyUp(event: KeyboardEvent) {
    if (!MODIFIER_KEYS.has(event.key)) return;
    if (!state.hoverPreview.value) return;
    state.setPreview(hooks.computePreview(last.x, last.y, event));
    if (!state.hoverPreview.value) hooks.draw();
  }

  function resizeCanvas() {
    const rect = stageRef.value?.getBoundingClientRect();
    if (viewport.resize(rect?.width, rect?.height)) hooks.draw();
  }

  async function revealInspector() {
    const reveal = hooks.inspectorReveal();
    if (!reveal) return;
    if (reveal.lock) state.inspectorLock.value = reveal.lock;
    revealInProgress.value = true;
    expandedSections.value = [reveal.section];
    await nextTick();
    revealInProgress.value = false;
    if (!reveal.selector) return;
    windowRef.value?.querySelector<HTMLElement>(reveal.selector)?.scrollIntoView({ block: 'nearest' });
  }

  function onExpandedSectionsUpdate() {
    if (revealInProgress.value) return;
    state.inspectorLock.value = null;
  }

  useShortcutDispatch({
    commands: { undo: () => void runAction(doUndo), redo: () => void runAction(doRedo) },
    keys: {
      ' ': () => void runAction(toggleMirrorMode),
      backspace: () => {
        void runAction(() => {
          hooks.deleteSelected();
        });
      },
      t: () => void revealInspector(),
      ...Object.fromEntries(Object.entries(hooks.shortcutKeys).map(([key, action]) => [key, () => void runAction(action)])),
    },
  });

  onMounted(() => {
    stopPixelRatio = watchCanvasPixelRatio(resizeCanvas);
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    void nextTick(() => {
      windowRef.value?.focus({ preventScroll: true });
      resizeCanvas();
      hooks.onReady?.();
    });
  });

  onUnmounted(() => {
    stopPixelRatio?.();
    window.removeEventListener('resize', resizeCanvas);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
  });

  return {
    commitEdit,
    captureActionContext,
    runAction,
    doRedo,
    doUndo,
    drawBase,
    drawCursorPosition,
    drawHoverPreview,
    drawMirrorAxis,
    drawPixelImage: drawing.drawPixelImage,
    onDown,
    onExpandedSectionsUpdate,
    onLeave,
    onMove,
    onUp,
    onWheel,
    beginEdit,
    beginField,
    endField,
    fieldBlur,
    fieldKey,
    resetSelection,
    toggleMirrorMode,
  };
}
