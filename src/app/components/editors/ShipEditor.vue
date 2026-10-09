<template>
  <div class="modal-backdrop">
    <div ref="editorWindowRef" class="editor-window" tabindex="-1">
      <EditorHeader
        title="舰船编辑器"
        :subtitle="str(localShip.hullName) || hullId"
        :dirty="dirty"
        :external-update-notice="externalUpdateNotice"
        @load-external="$emit('load-external')"
      >
        <div class="ship-mode-controls">
          <div class="segmented ship-mode-tabs">
            <button
              v-for="m in modes"
              :key="m.value"
              :class="{ active: mode === m.value }"
              @click="canvas.runAction(() => setMode(m.value))"
            >
              {{ m.label }} <span class="ship-mode-shortcut">{{ m.shortcut }}</span>
            </button>
          </div>
          <span class="ship-mode-hint">T 打开右侧</span>
        </div>
      </EditorHeader>
      <div class="editor-body">
        <div ref="stageRef" class="canvas-stage">
          <canvas
            ref="canvasRef"
            class="editor-canvas"
            @mousedown="onDown"
            @mousemove="onMove"
            @mouseup="onUp"
            @mouseleave="onLeave"
            @wheel.prevent="onWheel"
            @contextmenu.prevent
          />
        </div>
        <EditorInspector
          title="舰船检查器"
          @focusin.capture="canvas.beginField"
          @focusout.capture="canvas.fieldBlur"
          @keyup.capture="canvas.fieldKey"
        >
          <n-collapse
            v-model:expanded-names="expandedSections"
            :theme-overrides="editorCollapseTheme"
            @update:expanded-names="onExpandedSectionsUpdate"
          >
            <n-collapse-item title="船体属性" name="basic">
              <div class="form-grid">
                <label>hullId</label><n-input :value="localShip.hullId" @update:value="setField('hullId', $event)" /> <label>hullName</label
                ><n-input :value="localShip.hullName" @update:value="setField('hullName', $event)" /> <label>hullSize</label
                ><n-select
                  :value="localShip.hullSize"
                  :options="toOptions(['FRIGATE', 'DESTROYER', 'CRUISER', 'CAPITAL_SHIP', 'FIGHTER'])"
                  @update:value="setField('hullSize', $event)"
                />
                <label>style</label
                ><n-select
                  :value="localShip.style"
                  filterable
                  tag
                  :options="toOptions(['LOW_TECH', 'MIDLINE', 'HIGH_TECH', 'OMEGA', 'CUSTOM'])"
                  @update:value="setField('style', $event)"
                />
                <label>width</label><NumberValueInput :value="localShip.width" @update:value="setVisualField('width', $event)" />
                <label>height</label><NumberValueInput :value="localShip.height" @update:value="setVisualField('height', $event)" />
              </div>
            </n-collapse-item>
            <n-collapse-item title="贴图" name="sprite">
              <div class="form-grid">
                <label>spriteName</label>
                <div class="sprite-field-row">
                  <n-input :value="localShip.spriteName" @update:value="setField('spriteName', $event)" @change="loadSprite" />
                  <n-button
                    class="sprite-icon-button"
                    tertiary
                    title="浏览贴图（引用 Mod 内文件）"
                    aria-label="浏览贴图"
                    @click="canvas.runAction(pickShipSprite)"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M4 19V5h6l2 2h8v12H4z" />
                      <path d="M8 14h8M12 10v8" />
                    </svg>
                  </n-button>
                </div>
                <label>sprite width</label><NumberValueInput :value="spriteSize.width || null" disabled /> <label>sprite height</label
                ><NumberValueInput :value="spriteSize.height || null" disabled />
              </div>
              <div class="sprite-actions">
                <n-button :disabled="!canSyncSpriteSize" @click="canvas.runAction(syncSpriteSize)">更新贴图宽高</n-button>
              </div>
            </n-collapse-item>
            <n-collapse-item title="中心与护盾" name="props">
              <div class="form-grid">
                <label data-inspector-field="center-x">center X</label
                ><NumberValueInput :value="center[0]" @update:value="setArray('center', 0, $event)" />
                <label data-inspector-field="center-y">center Y</label
                ><NumberValueInput :value="center[1]" @update:value="setArray('center', 1, $event)" /> <label>collisionRadius</label
                ><NumberValueInput :value="localShip.collisionRadius" @update:value="setVisualField('collisionRadius', $event)" />
                <label data-inspector-field="shield-x">shield X</label
                ><NumberValueInput :value="shieldCenter[0]" @update:value="setArray('shieldCenter', 0, $event)" />
                <label data-inspector-field="shield-y">shield Y</label
                ><NumberValueInput :value="shieldCenter[1]" @update:value="setArray('shieldCenter', 1, $event)" />
                <label>shieldRadius</label
                ><NumberValueInput :value="localShip.shieldRadius" @update:value="setVisualField('shieldRadius', $event)" />
              </div>
            </n-collapse-item>
            <n-collapse-item title="武器槽" name="weapons">
              <div class="item-list">
                <button
                  v-for="item in normalWeaponSlots"
                  :key="item.index"
                  :data-inspector-target="`weapon-${item.index}`"
                  :class="{ selected: mode === 'weapon' && selected === item.index }"
                  @click="canvas.runAction(() => selectInspectorItem('weapon', item.index, 'weapon'))"
                >
                  {{ item.slot.id || `slot ${item.index}` }} <span>{{ item.slot.size }} {{ item.slot.type }}</span>
                </button>
              </div>
              <div v-if="mode === 'weapon' && selectedSlot" class="form-grid">
                <label>id</label><n-input :value="selectedSlot.id" @update:value="setSlotField('id', $event)" /> <label>size</label
                ><n-select
                  :value="selectedSlot.size"
                  :options="toOptions(['SMALL', 'MEDIUM', 'LARGE'])"
                  @update:value="setSlotField('size', $event)"
                />
                <label>type</label
                ><n-select
                  :value="selectedSlot.type"
                  :options="
                    toOptions([
                      'BALLISTIC',
                      'ENERGY',
                      'MISSILE',
                      'HYBRID',
                      'UNIVERSAL',
                      'SYNERGY',
                      'COMPOSITE',
                      'BUILT_IN',
                      'DECORATIVE',
                      'SYSTEM',
                      'STATION_MODULE',
                    ])
                  "
                  @update:value="setSlotField('type', $event)"
                />
                <label>mount</label
                ><n-select
                  :value="selectedSlot.mount"
                  :options="toOptions(['TURRET', 'HARDPOINT', 'HIDDEN'])"
                  @update:value="setSlotField('mount', $event)"
                />
                <label>angle</label><NumberValueInput :value="selectedSlot.angle" @update:value="setSlotField('angle', $event)" />
                <label>arc</label><NumberValueInput :value="selectedSlot.arc" @update:value="setSlotField('arc', $event)" />
                <label>loc X</label><NumberValueInput :value="slotLoc[0]" @update:value="setSlotLoc(0, $event)" /> <label>loc Y</label
                ><NumberValueInput :value="slotLoc[1]" @update:value="setSlotLoc(1, $event)" />
              </div>
              <div class="action-row button-row">
                <n-button @click="canvas.runAction(addWeaponSlot)">添加</n-button
                ><n-button type="error" ghost @click="canvas.runAction(deleteSelected)">删除</n-button>
              </div>
            </n-collapse-item>
            <n-collapse-item title="甲板" name="launchBays">
              <div class="item-list">
                <button
                  v-for="item in launchBaySlots"
                  :key="item.index"
                  :data-inspector-target="`launchBay-${item.index}`"
                  :class="{ selected: mode === 'launchBay' && selected === item.index }"
                  @click="canvas.runAction(() => selectInspectorItem('launchBay', item.index, 'weapon'))"
                >
                  {{ item.slot.id || `LB ${item.index + 1}` }} <span>甲板 · {{ bayPorts(item.slot.locations).length }}</span>
                </button>
              </div>
              <div v-if="mode === 'launchBay' && selectedSlot" class="form-grid">
                <label>id</label><n-input :value="selectedSlot.id" @update:value="setSlotField('id', $event)" />
              </div>
              <div v-if="mode === 'launchBay' && selectedSlot" class="port-rows">
                <div
                  v-for="(port, portIndex) in selectedBayPorts"
                  :key="portIndex"
                  class="port-row"
                  :class="{ selected: portIndex === selectedPort }"
                  @click="canvas.runAction(() => (selectedPort = portIndex))"
                >
                  <span>P{{ portIndex + 1 }}</span>
                  <NumberValueInput size="small" :value="port[0]" @update:value="setBayPortCoord(portIndex, 0, $event)" @click.stop />
                  <NumberValueInput size="small" :value="port[1]" @update:value="setBayPortCoord(portIndex, 1, $event)" @click.stop />
                  <n-button size="tiny" quaternary type="error" @click.stop="canvas.runAction(() => removeBayPortAt(portIndex))"
                    >删</n-button
                  >
                </div>
              </div>
              <div class="action-row button-row">
                <n-button :disabled="!selectedSlot" @click="canvas.runAction(addBayPortFromPanel)">添加港口</n-button>
                <n-button @click="canvas.runAction(addLaunchBay)">添加</n-button
                ><n-button type="error" ghost @click="canvas.runAction(deleteSelected)">删除</n-button>
              </div>
            </n-collapse-item>
            <n-collapse-item title="引擎" name="engines">
              <div class="item-list">
                <button
                  v-for="(eng, i) in engineSlots"
                  :key="entryKey('engine-slot', eng, i)"
                  :data-inspector-target="`engine-${i}`"
                  :class="{ selected: mode === 'engine' && selected === i }"
                  @click="canvas.runAction(() => selectInspectorItem('engine', i, 'engine'))"
                >
                  引擎 {{ i }} <span>{{ eng.width }}x{{ eng.length }}</span>
                </button>
              </div>
              <div v-if="mode === 'engine' && selectedEngine" class="form-grid">
                <label>angle</label><NumberValueInput :value="selectedEngine.angle" @update:value="setEngineField('angle', $event)" />
                <label>width</label><NumberValueInput :value="selectedEngine.width" @update:value="setEngineField('width', $event)" />
                <label>length</label><NumberValueInput :value="selectedEngine.length" @update:value="setEngineField('length', $event)" />
                <label>contrailSize</label
                ><NumberValueInput :value="selectedEngine.contrailSize" @update:value="setEngineField('contrailSize', $event)" />
                <label>style</label
                ><n-select
                  :value="selectedEngine.style"
                  filterable
                  tag
                  :options="toOptions(['LOW_TECH', 'MIDLINE', 'HIGH_TECH', 'OMEGA', 'CUSTOM'])"
                  @update:value="setEngineField('style', $event)"
                />
                <label>loc X</label><NumberValueInput :value="engineLoc[0]" @update:value="setEngineLoc(0, $event)" /> <label>loc Y</label
                ><NumberValueInput :value="engineLoc[1]" @update:value="setEngineLoc(1, $event)" />
              </div>
              <div class="action-row button-row">
                <n-button @click="canvas.runAction(addEngine)">添加</n-button
                ><n-button type="error" ghost @click="canvas.runAction(deleteSelected)">删除</n-button>
              </div>
            </n-collapse-item>
            <n-collapse-item title="碰撞边界" name="bounds">
              <div class="bounds-list">
                <div
                  v-for="(_, i) in boundPairs"
                  :key="`bound-${i}`"
                  :data-inspector-target="`bound-${i}`"
                  :class="{ selected: mode === 'bounds' && selected === i }"
                  @click="canvas.runAction(() => selectInspectorItem('bounds', i, 'bound'))"
                >
                  <span>{{ i }}</span>
                  <NumberValueInput :value="bounds[i * 2]" @update:value="setBound(i * 2, $event)" />
                  <NumberValueInput :value="bounds[i * 2 + 1]" @update:value="setBound(i * 2 + 1, $event)" />
                </div>
              </div>
              <div class="action-row button-row">
                <n-button @click="canvas.runAction(addBound)">添加点</n-button
                ><n-button type="error" ghost @click="canvas.runAction(deleteSelected)">删除点</n-button>
              </div>
            </n-collapse-item>
            <n-collapse-item title="高级属性" name="advanced">
              <div class="form-grid">
                <label>viewOffset</label><n-input :value="localShip.viewOffset" @update:value="setField('viewOffset', $event)" />
                <label>coversColor</label
                ><n-input
                  :value="localShip.coversColor"
                  placeholder="R,G,B,A (如 255,255,255,255)"
                  @update:value="setField('coversColor', $event)"
                />
                <label>moduleAnchor X</label
                ><NumberValueInput :value="moduleAnchor[0]" @update:value="setArray('moduleAnchor', 0, $event)" />
                <label>moduleAnchor Y</label
                ><NumberValueInput :value="moduleAnchor[1]" @update:value="setArray('moduleAnchor', 1, $event)" />
              </div>
            </n-collapse-item>
            <n-collapse-item title="内置装备" name="builtins">
              <JsonValueInput :value="localShip.builtInWeapons" label="builtInWeapons" shape="object" @update="builtInWeaponsUpdated" />
              <label>builtInMods</label><n-dynamic-tags v-model:value="builtInMods" /> <label>builtInWings</label
              ><n-dynamic-tags v-model:value="builtInWings" />
            </n-collapse-item>
          </n-collapse>
        </EditorInspector>
      </div>
      <EditorFooter :note="footerNote">
        <template #actions>
          <n-button @click="$emit('close')">关闭</n-button>
          <n-button type="primary" :disabled="!canSave" :loading="saving" @click="save">保存</n-button>
        </template>
      </EditorFooter>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import EditorFooter from '@/app/components/editors/common/EditorFooter.vue';
import EditorHeader from '@/app/components/editors/common/EditorHeader.vue';
import EditorInspector from '@/app/components/editors/common/EditorInspector.vue';
import JsonValueInput from '@/shared/ui/JsonValueInput.vue';
import NumberValueInput from '@/shared/ui/NumberValueInput.vue';
import type { RowData, EditContext } from '@/shared/types';
import { arr, deepClone, num, str } from '@/shared/lib/starsector';
import { entryKey } from '@/shared/lib/entry-keys';
import { normalizeShipSpec } from '@/domain/editors/lib/normalize';
import { distance, distanceToSegment, pointAngle, pointArc } from '@/domain/editors/lib/geometry';
import {
  appendBayPort,
  bayPorts,
  engineWithDefaults,
  formatLaunchBayId,
  formatWeaponSlotId,
  launchBayWithDefaults,
  nextFormattedId,
  removeBayPort,
  updateBayPort,
  weaponSlotWithDefaults,
} from '@/domain/editors/lib/ship-slots';
import {
  createCanvasEditorState,
  useCanvasEditor,
  type CanvasInspectorReveal,
  type CanvasModifiers,
  type CanvasPick,
  type CanvasTarget,
} from '@/app/composables/canvas/use-canvas-editor';
import { useCanvasViewport } from '@/app/composables/canvas/use-canvas-viewport';
import { useResourceReference } from '@/app/composables/editors/use-resource-reference';
import { editorCollapseTheme, snapToStep, toOptions } from '@/domain/editors/lib/editor-constants';
import {
  drawBoundsVisual,
  drawEngineVisual,
  drawLaunchBayPortVisual,
  drawRadiusField,
  drawWeaponSlotVisual,
} from '@/domain/editors/lib/canvas-visuals';
import {
  findMirrorBoundIndex,
  findMirrorEngineIndex,
  findMirrorWeaponSlotIndex,
  mirrorAngleDeg,
  mirrorBayPort,
  mirrorEngineForAdd,
  mirrorLateral,
  mirrorOffsetPoint,
  mirrorWeaponSlotForAdd,
  MIRROR_EPSILON,
} from '@/domain/editors/lib/mirror';

const props = defineProps<{
  modRoot: string;
  sessionId: string;
  hullId: string;
  ship: RowData;
  spriteData?: string;
  editContext: EditContext | null;
  dirty: boolean;
  canSave: boolean;
  saving: boolean;
  externalUpdateNotice: string;
}>();
const emit = defineEmits<{ close: []; 'save-requested': []; 'draft-changed': [ship: RowData]; 'load-external': [] }>();
const feedback = useAppFeedback();
const { pickModImageReference } = useResourceReference();
const editorWindowRef = useTemplateRef<HTMLElement>('editorWindowRef');
const stageRef = useTemplateRef<HTMLElement>('stageRef');
const canvasRef = useTemplateRef<HTMLCanvasElement>('canvasRef');
const localShip = ref<RowData>(normalizeShipSpec(props.ship));
const mode = ref<'overview' | 'ranges' | 'bounds' | 'weapon' | 'launchBay' | 'engine'>('overview');
const selectedPort = ref<number | null>(null);
const expandedSections = ref(['basic']);
const img = new Image();
const spriteSize = ref({ width: 0, height: 0 });
type HoverPreview =
  | { kind: 'collisionRadius'; radius: number }
  | { kind: 'shieldRadius'; radius: number }
  | { kind: 'boundAppend'; coord: number[] }
  | { kind: 'boundInsert'; coord: number[]; insertAfter: number }
  | { kind: 'weaponCopy'; coord: number[]; slot: RowData }
  | { kind: 'weaponMove'; coord: number[]; slot: RowData }
  | { kind: 'weaponArc'; arc: number }
  | { kind: 'launchBayAdd'; coord: number[]; slot: RowData }
  | { kind: 'launchBayPortAdd'; coord: number[] }
  | { kind: 'engineCopy'; coord: number[]; engine: RowData }
  | { kind: 'engineMove'; coord: number[]; engine: RowData }
  | { kind: 'engineSize'; length: number; width: number }
  | null;
const viewport = useCanvasViewport(canvasRef, 1, 10);
const { scale } = viewport;
const editorState = createCanvasEditorState<HoverPreview>();
const { activeTarget, clearPreview, dragKind, hoverPreview, hovered, inspectorLock, mirrorMode, mirrorPair, selected } = editorState;
const canvas = useCanvasEditor({
  context: computed(() => props.editContext),
  stageRef,
  windowRef: editorWindowRef,
  expandedSections,
  viewport,
  state: editorState,
  hooks: {
    value: localShip,
    sourceValue: () => props.ship,
    onDraftMutated: (value) => emit('draft-changed', value),
    normalize: normalizeShipSpec,
    deleteSelected,
    shortcutKeys: {
      p: () => setMode('overview'),
      c: () => setMode('ranges'),
      b: () => setMode('bounds'),
      w: () => setMode('weapon'),
      l: () => setMode('launchBay'),
      e: () => setMode('engine'),
    },
    inspectorReveal: (): CanvasInspectorReveal | null => {
      const section = modeToSection[mode.value];
      const selector = currentInspectorTargetSelector();
      if (!section || !selector) return null;
      return { section, selector, lock: activeTarget.value ? { ...activeTarget.value } : null };
    },
    selectableTargets,
    hitRadius: targetHitRadius,
    actionDown,
    selectForDown,
    resolveDragKind,
    captureMirrorPair,
    applyDrag: updateInteraction,
    applyMirrorDrag: applyMirrorInteraction,
    previewTakesOver: shouldPauseAutoSnap,
    computePreview,
    drawPreview,
    cursorMarker,
    mirrorAxisCanvasY: () => shipCenterPoint().y,
    onReady: () => {
      if (props.spriteData) loadSprite();
    },
    draw,
  },
});
const {
  commitEdit,
  drawBase,
  drawCursorPosition,
  drawHoverPreview,
  drawMirrorAxis,
  drawPixelImage,
  onDown,
  onExpandedSectionsUpdate,
  onLeave,
  onMove,
  onUp,
  onWheel,
  beginEdit,
} = canvas;
const modes = [
  { shortcut: 'P', value: 'overview', label: '总览' },
  { shortcut: 'C', value: 'ranges', label: '范围' },
  { shortcut: 'B', value: 'bounds', label: '边界' },
  { shortcut: 'W', value: 'weapon', label: '武器' },
  { shortcut: 'L', value: 'launchBay', label: '甲板' },
  { shortcut: 'E', value: 'engine', label: '引擎' },
] as const;
type InspectorSection = 'basic' | 'sprite' | 'props' | 'weapons' | 'launchBays' | 'engines' | 'bounds' | 'advanced' | 'builtins';
const modeToSection: Record<typeof mode.value, InspectorSection | null> = {
  overview: null,
  ranges: 'props',
  bounds: 'bounds',
  weapon: 'weapons',
  launchBay: 'launchBays',
  engine: 'engines',
};
const modeFooterNotes: Record<typeof mode.value, string> = {
  overview: '仅查看',
  ranges: '左键 拖动中心或护盾 | Shift+左键 改碰撞半径 | Ctrl+左键 改护盾半径 | T 打开中心与护盾',
  bounds: '左键 拖动边界点 | Shift+左键 追加边界点 | Ctrl+左键 插入最近边段 | T 打开碰撞边界',
  weapon: '左键 旋转角度 | Shift+左键 复制武器槽 | Ctrl+左键 移动位置 | Alt+左键 调整射角 | T 打开武器槽',
  launchBay: '左键 选中港口 | 拖动 移动港口 | Ctrl+左键 新建甲板 | Shift+左键 为选中甲板新增港口 | T 打开甲板',
  engine: '左键 旋转角度 | Shift+左键 复制引擎 | Ctrl+左键 移动位置 | Alt+左键 调整宽高 | T 打开引擎',
};
const footerNote = computed(() => {
  const mirrorBadge = mirrorMode.value ? '（镜像模式）' : '';
  const mirrorHint = mirrorMode.value ? ' | 空格 关闭镜像' : ' | 空格 开启镜像';
  return `右键 拖动画布 | 滚轮 缩放 | Ctrl+Z 撤销 | Ctrl+Shift+Z 重做${mirrorBadge}\n${modeFooterNotes[mode.value]}${mirrorHint}`;
});

const weaponSlots = computed<RowData[]>(() =>
  Array.isArray(localShip.value.weaponSlots) ? (localShip.value.weaponSlots as RowData[]) : [],
);
const normalWeaponSlots = computed(() =>
  weaponSlots.value.map((slot, index) => ({ index, slot })).filter((item) => str(item.slot.type).toUpperCase() !== 'LAUNCH_BAY'),
);
const launchBaySlots = computed(() =>
  weaponSlots.value.map((slot, index) => ({ index, slot })).filter((item) => str(item.slot.type).toUpperCase() === 'LAUNCH_BAY'),
);
const engineSlots = computed<RowData[]>(() =>
  Array.isArray(localShip.value.engineSlots) ? (localShip.value.engineSlots as RowData[]) : [],
);
const bounds = computed<number[]>(() => (Array.isArray(localShip.value.bounds) ? (localShip.value.bounds as number[]) : []));
const boundPairs = computed(() => Array.from({ length: Math.floor(bounds.value.length / 2) }));
const center = computed(() => arr(localShip.value.center, [0, 0]));
const shieldCenter = computed(() => arr(localShip.value.shieldCenter, [0, 0]));
const moduleAnchor = computed(() => arr(localShip.value.moduleAnchor, [0, 0]));
const selectedSlot = computed(() => (selected.value === null ? null : weaponSlots.value[selected.value]));
const selectedEngine = computed(() => (selected.value === null ? null : engineSlots.value[selected.value]));
const slotLoc = computed(() => arr(selectedSlot.value?.locations, [0, 0]));
const selectedBayPorts = computed(() => bayPorts(selectedSlot.value?.locations));
const engineLoc = computed(() => arr(selectedEngine.value?.location, [0, 0]));
const builtInMods = computed({
  get: () => (Array.isArray(localShip.value.builtInMods) ? (localShip.value.builtInMods as string[]) : []),
  set: (v) => {
    localShip.value.builtInMods = v;
    commitEdit();
  },
});
const builtInWings = computed({
  get: () => (Array.isArray(localShip.value.builtInWings) ? (localShip.value.builtInWings as string[]) : []),
  set: (v) => {
    localShip.value.builtInWings = v;
    commitEdit();
  },
});

function setMode(value: typeof mode.value) {
  mode.value = value;
  selected.value = null;
  hovered.value = null;
  activeTarget.value = null;
  inspectorLock.value = null;
  clearPreview();
  draw();
}
function canvasCenter() {
  return viewport.center();
}
function shipCenterPoint() {
  return shipToCanvas(center.value);
}
function shipToCanvas(loc: number[]) {
  const origin = canvasCenter();
  return { x: origin.x + (loc[1] || 0) * scale.value, y: origin.y + (loc[0] || 0) * scale.value };
}
function relativeToCanvas(loc: number[]) {
  return shipToCanvas(relativeToAbsolute(loc));
}
function canvasToShip(x: number, y: number): [number, number] {
  const point = rawCanvasToShip(x, y);
  return [snapToStep(point[0]), snapToStep(point[1])];
}
function rawCanvasToShip(x: number, y: number): [number, number] {
  const origin = canvasCenter();
  return [(y - origin.y) / scale.value, (x - origin.x) / scale.value];
}
function canvasToRelative(x: number, y: number): [number, number] {
  const point = canvasToShip(x, y);
  return absoluteToRelative(point);
}
function relativeToAbsolute(loc: number[]): [number, number] {
  return [(center.value[0] || 0) - (loc[1] || 0), (center.value[1] || 0) + (loc[0] || 0)];
}
function absoluteToRelative(loc: number[]): [number, number] {
  return [snapToStep((loc[1] || 0) - (center.value[1] || 0)), snapToStep((center.value[0] || 0) - (loc[0] || 0))];
}
function targetKindAt(mx: number, my: number): string | null {
  if (mode.value !== 'ranges') return activeTarget.value?.kind || null;
  const raw = rawCanvasToShip(mx, my);
  const shieldDistance = distance(raw, relativeToAbsolute(shieldCenter.value));
  const centerDistance = distance(raw, center.value);
  if (distance([0, 0], shieldCenter.value) === 0 && shieldDistance === centerDistance) return 'shield';
  return shieldDistance < centerDistance ? 'shield' : 'center';
}
function updateSpriteSize() {
  spriteSize.value = { width: img.naturalWidth || img.width || 0, height: img.naturalHeight || img.height || 0 };
}
function loadSprite() {
  spriteSize.value = { width: 0, height: 0 };
  img.onload = () => {
    updateSpriteSize();
    if (img.width) scale.value = Math.min(1, 500 / Math.max(img.width, img.height));
    draw();
  };
  img.src = props.spriteData || '';
  if (str(localShip.value.spriteName) && !props.spriteData) img.src = '';
  draw();
}
const canSyncSpriteSize = computed(() => spriteSize.value.width > 0 && spriteSize.value.height > 0);
function syncSpriteSize() {
  if (!canSyncSpriteSize.value) return;
  beginEdit();
  localShip.value.width = spriteSize.value.width;
  localShip.value.height = spriteSize.value.height;
  commitEdit();
  draw();
}

function currentInspectorTargetSelector(): string {
  if (mode.value === 'weapon') return selected.value !== null ? `[data-inspector-target="weapon-${selected.value}"]` : '';
  if (mode.value === 'launchBay') return selected.value !== null ? `[data-inspector-target="launchBay-${selected.value}"]` : '';
  if (mode.value === 'engine') return selected.value !== null ? `[data-inspector-target="engine-${selected.value}"]` : '';
  if (mode.value === 'bounds') return selected.value !== null ? `[data-inspector-target="bound-${selected.value}"]` : '';
  if (mode.value === 'ranges') {
    if (activeTarget.value?.kind === 'center') return '[data-inspector-field="center-x"]';
    if (activeTarget.value?.kind === 'shield') return '[data-inspector-field="shield-x"]';
  }
  return '';
}

function currentRangePreview(coord: number[], modifiers: CanvasModifiers) {
  if (modifiers.shiftKey) return { kind: 'collisionRadius' as const, radius: Math.max(0, Math.round(distance(coord, center.value))) };
  if (modifiers.ctrlKey)
    return { kind: 'shieldRadius' as const, radius: Math.max(0, Math.round(distance(coord, relativeToAbsolute(shieldCenter.value)))) };
  return null;
}
function previewWeaponState(coord: number[], modifiers: CanvasModifiers, mx: number, my: number) {
  const relativeCoord = absoluteToRelative(coord);
  if (modifiers.altKey && selectedSlot.value) {
    return {
      kind: 'weaponArc' as const,
      arc: pointArc(relativeToAbsolute(slotLoc.value), rawCanvasToShip(mx, my), num(selectedSlot.value.angle, 0)),
    };
  }
  if (modifiers.shiftKey) {
    const source = selectedSlot.value ? deepClone(selectedSlot.value) : {};
    return {
      kind: 'weaponCopy' as const,
      coord: relativeCoord,
      slot: weaponSlotWithDefaults(source, nextWeaponSlotId(), relativeCoord),
    };
  }
  if (modifiers.ctrlKey && selectedSlot.value) {
    return { kind: 'weaponMove' as const, coord: relativeCoord, slot: { ...deepClone(selectedSlot.value), locations: relativeCoord } };
  }
  return null;
}
function previewLaunchBayState(coord: number[], modifiers: CanvasModifiers) {
  if (modifiers.ctrlKey) {
    const relativeCoord = absoluteToRelative(coord);
    const source = selectedSlot.value ? deepClone(selectedSlot.value) : {};
    return {
      kind: 'launchBayAdd' as const,
      coord: relativeCoord,
      slot: launchBayWithDefaults(source, nextLaunchBayId(), relativeCoord),
    };
  }
  if (modifiers.shiftKey && selected.value !== null) {
    return { kind: 'launchBayPortAdd' as const, coord: absoluteToRelative(coord) };
  }
  return null;
}
function previewEngineState(coord: number[], modifiers: CanvasModifiers, mx: number, my: number) {
  const relativeCoord = absoluteToRelative(coord);
  if (modifiers.altKey && selectedEngine.value) {
    const { length, width } = engineSizeFromPointer(mx, my);
    return { kind: 'engineSize' as const, length, width };
  }
  if (modifiers.shiftKey) {
    const source = selectedEngine.value ? deepClone(selectedEngine.value) : {};
    return {
      kind: 'engineCopy' as const,
      coord: relativeCoord,
      engine: engineWithDefaults(source, relativeCoord),
    };
  }
  if (modifiers.ctrlKey && selectedEngine.value) {
    return { kind: 'engineMove' as const, coord: relativeCoord, engine: { ...deepClone(selectedEngine.value), location: relativeCoord } };
  }
  return null;
}
function previewBoundsState(coord: number[], modifiers: CanvasModifiers) {
  const relativeCoord = absoluteToRelative(coord);
  if (modifiers.shiftKey) return { kind: 'boundAppend' as const, coord: relativeCoord };
  if (modifiers.ctrlKey)
    return { kind: 'boundInsert' as const, coord: relativeCoord, insertAfter: nearestBoundsSegmentIndex(relativeCoord) };
  return null;
}
function computePreview(mx: number, my: number, modifiers: CanvasModifiers): HoverPreview {
  const coord = canvasToShip(mx, my);
  if (mode.value === 'ranges') return currentRangePreview(coord, modifiers);
  if (mode.value === 'bounds') return previewBoundsState(coord, modifiers);
  if (mode.value === 'weapon') return previewWeaponState(coord, modifiers, mx, my);
  if (mode.value === 'launchBay') return previewLaunchBayState(coord, modifiers);
  if (mode.value === 'engine') return previewEngineState(coord, modifiers, mx, my);
  return null;
}
function shouldPauseAutoSnap(modifiers: CanvasModifiers) {
  if (mode.value === 'ranges') return modifiers.shiftKey || modifiers.ctrlKey;
  if (mode.value === 'bounds') return modifiers.shiftKey || modifiers.ctrlKey;
  if (mode.value === 'weapon') return modifiers.altKey || modifiers.ctrlKey || modifiers.shiftKey;
  if (mode.value === 'launchBay') return modifiers.shiftKey || modifiers.ctrlKey;
  if (mode.value === 'engine') return modifiers.altKey || modifiers.ctrlKey || modifiers.shiftKey;
  return false;
}

function drawPreviewBounds(ctx: CanvasRenderingContext2D, preview: NonNullable<HoverPreview>) {
  if (preview.kind !== 'boundAppend' && preview.kind !== 'boundInsert') return;
  const points = [];
  for (let i = 0; i < bounds.value.length; i += 2) points.push([bounds.value[i] ?? 0, bounds.value[i + 1] ?? 0]);
  if (preview.kind === 'boundAppend') {
    points.push(preview.coord);
    if (mirrorMode.value && Math.abs(preview.coord[1] || 0) > MIRROR_EPSILON) points.push(mirrorOffsetPoint(preview.coord));
  } else {
    points.splice(preview.insertAfter + 1, 0, preview.coord);
    if (mirrorMode.value && Math.abs(preview.coord[1] || 0) > MIRROR_EPSILON)
      points.splice(preview.insertAfter + 2, 0, mirrorOffsetPoint(preview.coord));
  }
  if (points.length < 2) return;
  ctx.save();
  ctx.globalAlpha = 0.55;
  drawBoundsVisual(ctx, points.map(relativeToCanvas), points.length - 1, points.length - 1);
  ctx.restore();
}
function drawPreview(ctx: CanvasRenderingContext2D, preview: NonNullable<HoverPreview>) {
  ctx.save();
  ctx.globalAlpha = 0.55;
  if (preview.kind === 'collisionRadius') {
    drawRadiusField(ctx, shipCenterPoint(), preview.radius * scale.value, 'rgba(249, 210, 75, 0.28)', false, true);
  }
  if (preview.kind === 'shieldRadius') {
    drawRadiusField(ctx, relativeToCanvas(shieldCenter.value), preview.radius * scale.value, 'rgba(79, 209, 197, 0.28)', false, true, 'x');
  }
  if (preview.kind === 'weaponCopy' || preview.kind === 'weaponMove' || preview.kind === 'launchBayAdd') {
    drawWeaponSlotVisual(ctx, {
      angle: num(preview.slot.angle, 0),
      arc: num(preview.slot.arc, 0),
      hovered: true,
      mount: str(preview.slot.mount),
      point: relativeToCanvas(preview.coord),
      selected: true,
      size: str(preview.slot.size, 'MEDIUM'),
      type: str(preview.slot.type, 'SYSTEM'),
    });
    if (mirrorMode.value && Math.abs(preview.coord[1] || 0) > MIRROR_EPSILON) {
      drawWeaponSlotVisual(ctx, {
        angle: mirrorAngleDeg(num(preview.slot.angle, 0)),
        arc: num(preview.slot.arc, 0),
        hovered: true,
        mount: str(preview.slot.mount),
        point: relativeToCanvas(mirrorOffsetPoint(preview.coord)),
        selected: true,
        size: str(preview.slot.size, 'MEDIUM'),
        type: str(preview.slot.type, 'SYSTEM'),
      });
    }
  }
  if (preview.kind === 'launchBayPortAdd') {
    drawLaunchBayPortVisual(ctx, { point: relativeToCanvas(preview.coord), selected: true });
    if (mirrorMode.value && Math.abs(preview.coord[1] || 0) > MIRROR_EPSILON) {
      drawLaunchBayPortVisual(ctx, { point: relativeToCanvas(mirrorBayPort(preview.coord)), selected: true });
    }
  }
  if (preview.kind === 'weaponArc' && selectedSlot.value) {
    drawWeaponSlotVisual(ctx, {
      angle: num(selectedSlot.value.angle, 0),
      arc: preview.arc,
      hovered: true,
      mount: str(selectedSlot.value.mount),
      point: relativeToCanvas(slotLoc.value),
      selected: true,
      size: str(selectedSlot.value.size, 'MEDIUM'),
      type: str(selectedSlot.value.type, 'SYSTEM'),
    });
  }
  if (preview.kind === 'engineCopy') {
    drawEngineVisual(ctx, {
      angle: num(preview.engine.angle, 0),
      hovered: true,
      length: num(preview.engine.length, 20),
      point: relativeToCanvas(preview.coord),
      scale: scale.value,
      selected: true,
      width: num(preview.engine.width, 10),
    });
    if (mirrorMode.value && Math.abs(preview.coord[1] || 0) > MIRROR_EPSILON) {
      drawEngineVisual(ctx, {
        angle: mirrorAngleDeg(num(preview.engine.angle, 0)),
        hovered: true,
        length: num(preview.engine.length, 20),
        point: relativeToCanvas(mirrorOffsetPoint(preview.coord)),
        scale: scale.value,
        selected: true,
        width: num(preview.engine.width, 10),
      });
    }
  }
  if (preview.kind === 'engineMove') {
    drawEngineVisual(ctx, {
      angle: num(preview.engine.angle, 0),
      hovered: true,
      length: num(preview.engine.length, 20),
      point: relativeToCanvas(preview.coord),
      scale: scale.value,
      selected: true,
      width: num(preview.engine.width, 10),
    });
    if (mirrorMode.value && Math.abs(preview.coord[1] || 0) > MIRROR_EPSILON) {
      drawEngineVisual(ctx, {
        angle: mirrorAngleDeg(num(preview.engine.angle, 0)),
        hovered: true,
        length: num(preview.engine.length, 20),
        point: relativeToCanvas(mirrorOffsetPoint(preview.coord)),
        scale: scale.value,
        selected: true,
        width: num(preview.engine.width, 10),
      });
    }
  }
  if (preview.kind === 'engineSize' && selectedEngine.value) {
    drawEngineVisual(ctx, {
      angle: num(selectedEngine.value.angle, 0),
      hovered: true,
      length: preview.length,
      point: relativeToCanvas(engineLoc.value),
      scale: scale.value,
      selected: true,
      width: preview.width,
    });
  }
  ctx.restore();
  drawPreviewBounds(ctx, preview);
}
function formatCoord(coord: number[]) {
  return `${(coord[0] || 0).toFixed(1)}, ${(coord[1] || 0).toFixed(1)}`;
}
function cursorLabel(coord: number[]): string {
  if (dragKind.value === 'weaponAngle' && selectedSlot.value) return `${Math.round(num(selectedSlot.value.angle, 0))}°`;
  if (dragKind.value === 'weaponArc' && selectedSlot.value) return `${Math.round(num(selectedSlot.value.arc, 0))}°`;
  if (hoverPreview.value?.kind === 'weaponArc') return `${Math.round(hoverPreview.value.arc)}°`;
  if (dragKind.value === 'engineAngle' && selectedEngine.value) return `${Math.round(num(selectedEngine.value.angle, 0))}°`;
  if (dragKind.value === 'engineSize' && selectedEngine.value)
    return `${Math.round(num(selectedEngine.value.length, 0))} x ${Math.round(num(selectedEngine.value.width, 0))}`;
  if (hoverPreview.value?.kind === 'engineSize')
    return `${Math.round(hoverPreview.value.length)} x ${Math.round(hoverPreview.value.width)}`;
  if (mode.value === 'overview' || mode.value === 'ranges') return formatCoord(coord);
  return formatCoord(absoluteToRelative(coord));
}
function cursorMarker(mx: number, my: number) {
  const coord = canvasToShip(mx, my);
  return { point: shipToCanvas(coord), label: cursorLabel(coord) };
}

function draw() {
  const c = canvasRef.value;
  if (!c) return;
  const ctx = c.getContext('2d')!;
  drawBase(ctx);
  if (mirrorMode.value && (mode.value === 'weapon' || mode.value === 'launchBay' || mode.value === 'engine' || mode.value === 'bounds'))
    drawMirrorAxis(ctx);
  if (img.width) {
    const bottomLeft = shipToCanvas([0, 0]);
    const drawWidth = img.height * scale.value;
    ctx.globalAlpha = 0.72;
    ctx.save();
    ctx.translate(bottomLeft.x + drawWidth, bottomLeft.y);
    ctx.rotate(Math.PI / 2);
    drawPixelImage(ctx, img, 0, 0, img.width * scale.value, img.height * scale.value);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  if (bounds.value.length >= 4 && (mode.value === 'bounds' || mode.value === 'overview')) {
    const points = [];
    for (let i = 0; i < bounds.value.length; i += 2) points.push(relativeToCanvas([bounds.value[i] ?? 0, bounds.value[i + 1] ?? 0]));
    drawBoundsVisual(
      ctx,
      points,
      mode.value === 'bounds' ? selected.value : null,
      mode.value === 'bounds' && hovered.value?.kind === 'bound' ? hovered.value.i : null,
    );
  }
  if (mode.value === 'ranges' || mode.value === 'overview') {
    const sp = relativeToCanvas(shieldCenter.value);
    const cp = shipCenterPoint();
    drawRadiusField(
      ctx,
      cp,
      num(localShip.value.collisionRadius, 0) * scale.value,
      'rgba(118, 106, 57, 0.34)',
      dragKind.value === 'center',
      hovered.value?.kind === 'center',
    );
    drawRadiusField(
      ctx,
      sp,
      num(localShip.value.shieldRadius, 0) * scale.value,
      'rgba(95, 118, 126, 0.34)',
      dragKind.value === 'shield',
      hovered.value?.kind === 'shield',
      'x',
    );
  }
  if (mode.value === 'weapon' || mode.value === 'launchBay' || mode.value === 'overview')
    weaponSlots.value.forEach((slot, i) => {
      const isLaunchBay = str(slot.type).toUpperCase() === 'LAUNCH_BAY';
      if (mode.value === 'weapon' && isLaunchBay) return;
      if (mode.value === 'launchBay' && !isLaunchBay) return;
      if (hoverPreview.value?.kind === 'weaponMove' && mode.value === 'weapon' && i === selected.value) return;
      if (isLaunchBay) {
        const baySelected = selected.value === i;
        bayPorts(slot.locations).forEach((port, portIndex) => {
          drawLaunchBayPortVisual(ctx, {
            point: relativeToCanvas(port),
            hovered: hovered.value?.kind === 'launchBayPort' && hovered.value.i === i && hovered.value.port === portIndex,
            selected: baySelected,
            accent: baySelected && selectedPort.value === portIndex,
          });
        });
        return;
      }
      drawWeaponSlotVisual(ctx, {
        angle: num(slot.angle, 0),
        arc: num(slot.arc, 0),
        hovered: (mode.value === 'weapon' || mode.value === 'launchBay') && hovered.value?.kind === 'weapon' && hovered.value.i === i,
        mount: str(slot.mount),
        point: relativeToCanvas(arr(slot.locations, [0, 0])),
        selected: (mode.value === 'weapon' || mode.value === 'launchBay') && i === selected.value,
        size: str(slot.size, 'MEDIUM'),
        type: str(slot.type, 'SYSTEM'),
      });
    });
  if (mode.value === 'engine' || mode.value === 'overview')
    engineSlots.value.forEach((eng, i) => {
      if (hoverPreview.value?.kind === 'engineMove' && mode.value === 'engine' && i === selected.value) return;
      drawEngineVisual(ctx, {
        angle: num(eng.angle, 0),
        hovered: mode.value === 'engine' && hovered.value?.kind === 'engine' && hovered.value.i === i,
        length: num(eng.length, 20),
        point: relativeToCanvas(arr(eng.location, [0, 0])),
        scale: scale.value,
        selected: mode.value === 'engine' && i === selected.value,
        width: num(eng.width, 10),
      });
    });
  drawHoverPreview(ctx);
  drawCursorPosition(ctx);
}
function targetHitRadius(target: CanvasTarget) {
  if (target.kind === 'launchBayPort') return 16;
  if (target.kind === 'engine') return 28;
  if (target.kind === 'center' || target.kind === 'shield') return 30;
  return 26;
}
function selectableTargets(mx: number, my: number): CanvasTarget[] {
  const targets: CanvasTarget[] = [];
  if (mode.value === 'overview') return targets;
  if (mode.value === 'weapon' || mode.value === 'launchBay') {
    for (let i = weaponSlots.value.length - 1; i >= 0; i--) {
      const slot = weaponSlots.value[i];
      if (!slot) continue;
      const isLaunchBay = str(slot.type).toUpperCase() === 'LAUNCH_BAY';
      if (mode.value === 'weapon' && isLaunchBay) continue;
      if (mode.value === 'launchBay') {
        if (!isLaunchBay) continue;
        const ports = bayPorts(slot.locations);
        for (let port = ports.length - 1; port >= 0; port--) {
          const p = relativeToCanvas(ports[port] ?? [0, 0]);
          targets.push({ kind: 'launchBayPort', i, port, distance: Math.hypot(mx - p.x, my - p.y) });
        }
        continue;
      }
      const p = relativeToCanvas(arr(slot.locations, [0, 0]));
      targets.push({ kind: 'weapon', i, distance: Math.hypot(mx - p.x, my - p.y) });
    }
  }
  if (mode.value === 'engine') {
    for (let i = engineSlots.value.length - 1; i >= 0; i--) {
      const engine = engineSlots.value[i];
      if (!engine) continue;
      const p = relativeToCanvas(arr(engine.location, [0, 0]));
      targets.push({ kind: 'engine', i, distance: Math.hypot(mx - p.x, my - p.y) });
    }
  }
  if (mode.value === 'bounds') {
    for (let i = 0; i < bounds.value.length; i += 2) {
      const p = relativeToCanvas([bounds.value[i] ?? 0, bounds.value[i + 1] ?? 0]);
      targets.push({ kind: 'bound', i: i / 2, distance: Math.hypot(mx - p.x, my - p.y) });
    }
  }
  if (mode.value === 'ranges') {
    const sp = relativeToCanvas(shieldCenter.value);
    const cp = shipCenterPoint();
    targets.push({ kind: 'shield', i: 0, distance: Math.hypot(mx - sp.x, my - sp.y) });
    targets.push({ kind: 'center', i: 0, distance: Math.hypot(mx - cp.x, my - cp.y) });
  }
  return targets;
}
function selectForDown(e: MouseEvent, mx: number, my: number, pick: CanvasPick): CanvasTarget | null {
  if ((mode.value === 'weapon' || mode.value === 'engine') && (e.altKey || e.ctrlKey))
    return pick.byIdentity(inspectorLock.value ?? activeTarget.value) ?? pick.byPointer(mx, my);
  if (mode.value === 'ranges' && (e.shiftKey || e.ctrlKey)) return pick.byIdentity(activeTarget.value) ?? pick.byPointer(mx, my);
  const target = pick.byPointer(mx, my);
  if (mode.value === 'launchBay') selectedPort.value = target?.port ?? null;
  return target;
}
function resolveDragKind(e: MouseEvent, mx: number, my: number, target: CanvasTarget) {
  if (mode.value === 'weapon' && e.altKey) return 'weaponArc';
  if (mode.value === 'weapon' && e.ctrlKey) return 'weapon';
  if (mode.value === 'weapon') return 'weaponAngle';
  if (mode.value === 'engine' && e.altKey) return 'engineSize';
  if (mode.value === 'engine' && e.ctrlKey) return 'engine';
  if (mode.value === 'engine') return 'engineAngle';
  if (mode.value === 'ranges' && e.shiftKey) return 'collisionRadius';
  if (mode.value === 'ranges' && e.ctrlKey) return 'shieldRadius';
  if (mode.value === 'ranges') return targetKindAt(mx, my) || target.kind;
  return target.kind;
}
function nearestBoundsSegmentIndex(point: number[]) {
  const count = Math.floor(bounds.value.length / 2);
  if (count < 2) return count - 1;
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < count; i += 1) {
    const a = [bounds.value[i * 2] ?? 0, bounds.value[i * 2 + 1] ?? 0];
    const next = (i + 1) % count;
    const b = [bounds.value[next * 2] ?? 0, bounds.value[next * 2 + 1] ?? 0];
    const d = distanceToSegment(point, a, b);
    if (d < bestDistance) {
      bestDistance = d;
      bestIndex = i;
    }
  }
  return bestIndex;
}
function shiftRelativePosition(value: RowData[string] | undefined, dxAbsolute: number, dyAbsolute: number) {
  // Multi-port launch bays keep every coordinate pair in `locations`; only an
  // odd trailing number is dropped.
  const source = Array.isArray(value) ? value : [];
  const shifted: number[] = [];
  for (let index = 0; index + 1 < source.length; index += 2) {
    shifted.push(snapToStep((Number(source[index]) || 0) - dyAbsolute), snapToStep((Number(source[index + 1]) || 0) + dxAbsolute));
  }
  if (!shifted.length) return [snapToStep(-dyAbsolute), snapToStep(dxAbsolute)];
  return shifted;
}
function offsetRelativeFields(dxAbsolute: number, dyAbsolute: number) {
  localShip.value.shieldCenter = shiftRelativePosition(localShip.value.shieldCenter, dxAbsolute, dyAbsolute);
  for (const slot of weaponSlots.value) slot.locations = shiftRelativePosition(slot.locations, dxAbsolute, dyAbsolute);
  for (const engine of engineSlots.value) engine.location = shiftRelativePosition(engine.location, dxAbsolute, dyAbsolute);
  for (let i = 0; i < bounds.value.length; i += 2) {
    bounds.value[i] = snapToStep((bounds.value[i] || 0) - dyAbsolute);
    bounds.value[i + 1] = snapToStep((bounds.value[i + 1] || 0) + dxAbsolute);
  }
}
function copyWeaponSlotAt(coord: number[]) {
  const source = selectedSlot.value ? deepClone(selectedSlot.value) : {};
  const relativeCoord = absoluteToRelative(coord);
  const sourceIndex = weaponSlots.value.length;
  const created = weaponSlotWithDefaults(source, nextWeaponSlotId(), relativeCoord);
  weaponSlots.value.push(created);
  if (mirrorMode.value && Math.abs(relativeCoord[1] || 0) > MIRROR_EPSILON) {
    weaponSlots.value.push({ ...mirrorWeaponSlotForAdd(created), id: nextWeaponSlotId() });
    mirrorPair.value = { kind: 'weapon', i: sourceIndex + 1 };
  } else {
    mirrorPair.value = null;
  }
  selected.value = sourceIndex;
  hovered.value = { kind: 'weapon', i: selected.value };
  activeTarget.value = { kind: 'weapon', i: selected.value };
}
function addLaunchBayAt(coord: number[]) {
  const relativeCoord = absoluteToRelative(coord);
  const sourceIndex = weaponSlots.value.length;
  const created = launchBayWithDefaults({}, nextLaunchBayId(), relativeCoord);
  weaponSlots.value.push(created);
  if (mirrorMode.value && Math.abs(relativeCoord[1] || 0) > MIRROR_EPSILON) {
    weaponSlots.value.push({ ...mirrorWeaponSlotForAdd(created), id: nextLaunchBayId() });
    mirrorPair.value = { kind: 'weapon', i: sourceIndex + 1 };
  } else {
    mirrorPair.value = null;
  }
  selected.value = sourceIndex;
  selectedPort.value = 0;
  hovered.value = { kind: 'launchBayPort', i: selected.value, port: 0 };
  activeTarget.value = { kind: 'launchBayPort', i: selected.value, port: 0 };
}
function addBayPortAt(relativeCoord: number[]) {
  const slot = selectedSlot.value;
  if (!slot) return;
  const portCount = bayPorts(slot.locations).length;
  slot.locations = appendBayPort(slot.locations, relativeCoord);
  if (mirrorMode.value && Math.abs(relativeCoord[1] || 0) > MIRROR_EPSILON) {
    slot.locations = appendBayPort(slot.locations, mirrorBayPort(relativeCoord));
  }
  selectedPort.value = portCount;
  const bayIndex = selected.value ?? weaponSlots.value.indexOf(slot);
  hovered.value = { kind: 'launchBayPort', i: bayIndex, port: portCount };
  activeTarget.value = { kind: 'launchBayPort', i: bayIndex, port: portCount };
}
function copyEngineAt(coord: number[]) {
  const source = selectedEngine.value ? deepClone(selectedEngine.value) : {};
  const relativeCoord = absoluteToRelative(coord);
  const sourceIndex = engineSlots.value.length;
  const created = engineWithDefaults(source, relativeCoord);
  engineSlots.value.push(created);
  if (mirrorMode.value && Math.abs(relativeCoord[1] || 0) > MIRROR_EPSILON) {
    engineSlots.value.push(mirrorEngineForAdd(created));
    mirrorPair.value = { kind: 'engine', i: sourceIndex + 1 };
  } else {
    mirrorPair.value = null;
  }
  selected.value = sourceIndex;
  hovered.value = { kind: 'engine', i: selected.value };
  activeTarget.value = { kind: 'engine', i: selected.value };
}
function updateInteraction(kind: string, mx: number, my: number) {
  const coord = canvasToShip(mx, my);
  const rawCoord = rawCanvasToShip(mx, my);
  const relativeCoord = canvasToRelative(mx, my);
  if (kind === 'weapon' && selectedSlot.value) selectedSlot.value.locations = relativeCoord;
  if (kind === 'launchBayPort' && selectedSlot.value && selectedPort.value !== null) {
    selectedSlot.value.locations = updateBayPort(selectedSlot.value.locations, selectedPort.value, relativeCoord);
  }
  if (kind === 'engine' && selectedEngine.value) selectedEngine.value.location = relativeCoord;
  if (kind === 'bound' && selected.value !== null) {
    bounds.value[selected.value * 2] = relativeCoord[0];
    bounds.value[selected.value * 2 + 1] = relativeCoord[1];
  }
  if (kind === 'shield') localShip.value.shieldCenter = relativeCoord;
  if (kind === 'center') {
    const previous = center.value;
    localShip.value.center = coord;
    offsetRelativeFields((coord[0] || 0) - (previous[0] || 0), (coord[1] || 0) - (previous[1] || 0));
  }
  if (kind === 'collisionRadius') localShip.value.collisionRadius = Math.max(0, Math.round(distance(rawCoord, center.value)));
  if (kind === 'shieldRadius')
    localShip.value.shieldRadius = Math.max(0, Math.round(distance(rawCoord, relativeToAbsolute(shieldCenter.value))));
  if (kind === 'weaponAngle' && selectedSlot.value) {
    selectedSlot.value.angle = pointAngle(relativeToAbsolute(slotLoc.value), rawCoord);
  }
  if (kind === 'weaponArc' && selectedSlot.value) {
    selectedSlot.value.arc = pointArc(relativeToAbsolute(slotLoc.value), rawCoord, num(selectedSlot.value.angle, 0));
  }
  if (kind === 'engineAngle' && selectedEngine.value) {
    selectedEngine.value.angle = pointAngle(relativeToAbsolute(engineLoc.value), rawCoord);
  }
  if (kind === 'engineSize') applyEngineSizeFromPointer(mx, my);
}
function captureMirrorPair() {
  mirrorPair.value = null;
  if (!mirrorMode.value || selected.value === null) return;
  if (mode.value === 'weapon' || mode.value === 'launchBay') {
    const index = findMirrorWeaponSlotIndex(weaponSlots.value, selected.value);
    if (index !== null) mirrorPair.value = { kind: 'weapon', i: index };
    return;
  }
  if (mode.value === 'engine') {
    const index = findMirrorEngineIndex(engineSlots.value, selected.value);
    if (index !== null) mirrorPair.value = { kind: 'engine', i: index };
    return;
  }
  if (mode.value === 'bounds') {
    const index = findMirrorBoundIndex(bounds.value, selected.value);
    if (index !== null) mirrorPair.value = { kind: 'bound', i: index };
  }
}
function applyMirrorInteraction(kind: string) {
  if (!mirrorMode.value || !mirrorPair.value) return;
  const pair = mirrorPair.value;
  if (kind === 'weapon' && pair.kind === 'weapon') {
    const pairSlot = weaponSlots.value[pair.i];
    if (pairSlot) pairSlot.locations = mirrorOffsetPoint(arr(selectedSlot.value?.locations, [0, 0]));
    return;
  }
  if (kind === 'weaponAngle' && pair.kind === 'weapon') {
    const pairSlot = weaponSlots.value[pair.i];
    if (pairSlot) pairSlot.angle = mirrorAngleDeg(num(selectedSlot.value?.angle, 0));
    return;
  }
  if (kind === 'weaponArc' && pair.kind === 'weapon') {
    const pairSlot = weaponSlots.value[pair.i];
    if (pairSlot) pairSlot.arc = num(selectedSlot.value?.arc, 0);
    return;
  }
  if (kind === 'engine' && pair.kind === 'engine') {
    const pairEngine = engineSlots.value[pair.i];
    if (pairEngine) pairEngine.location = mirrorOffsetPoint(arr(selectedEngine.value?.location, [0, 0]));
    return;
  }
  if (kind === 'engineAngle' && pair.kind === 'engine') {
    const pairEngine = engineSlots.value[pair.i];
    if (pairEngine) pairEngine.angle = mirrorAngleDeg(num(selectedEngine.value?.angle, 0));
    return;
  }
  if (kind === 'engineSize' && pair.kind === 'engine') {
    const pairEngine = engineSlots.value[pair.i];
    if (pairEngine) {
      pairEngine.length = num(selectedEngine.value?.length, 0);
      pairEngine.width = num(selectedEngine.value?.width, 0);
    }
    return;
  }
  if (kind === 'bound' && pair.kind === 'bound' && selected.value !== null) {
    bounds.value[pair.i * 2] = bounds.value[selected.value * 2] || 0;
    bounds.value[pair.i * 2 + 1] = mirrorLateral(bounds.value[selected.value * 2 + 1] || 0);
  }
}
function startBoundsInsert(coord: number[], insertAfter: number) {
  const at = Math.max(0, Math.min(bounds.value.length, (insertAfter + 1) * 2));
  bounds.value.splice(at, 0, coord[0] ?? 0, coord[1] ?? 0);
  if (mirrorMode.value && Math.abs(coord[1] || 0) > MIRROR_EPSILON) {
    bounds.value.splice(at + 2, 0, coord[0] ?? 0, mirrorLateral(coord[1] || 0));
    mirrorPair.value = { kind: 'bound', i: at / 2 + 1 };
  } else {
    mirrorPair.value = null;
  }
  selected.value = at / 2;
  hovered.value = { kind: 'bound', i: selected.value };
  activeTarget.value = { kind: 'bound', i: selected.value };
}
function applyEngineSizeFromPointer(mx: number, my: number) {
  if (!selectedEngine.value) return;
  const { length, width } = engineSizeFromPointer(mx, my);
  selectedEngine.value.width = width;
  selectedEngine.value.length = length;
}
function engineSizeFromPointer(mx: number, my: number) {
  const point = canvasToRelative(mx, my);
  const origin = engineLoc.value;
  const angle = (num(selectedEngine.value?.angle, 0) * Math.PI) / 180;
  const dx = (point[0] || 0) - (origin[0] || 0);
  const dy = (point[1] || 0) - (origin[1] || 0);
  const along = dx * Math.cos(angle) + dy * Math.sin(angle);
  const across = -dx * Math.sin(angle) + dy * Math.cos(angle);
  return {
    length: Math.max(8, Math.round(Math.abs(along)) || num(selectedEngine.value?.length, 20)),
    width: Math.max(4, Math.round(Math.abs(across) * 2) || num(selectedEngine.value?.width, 10)),
  };
}
function actionDown(e: MouseEvent, mx: number, my: number) {
  const coord = canvasToShip(mx, my);
  const relativeCoord = canvasToRelative(mx, my);
  if (mode.value === 'bounds' && e.shiftKey) {
    beginEdit();
    bounds.value.push(relativeCoord[0], relativeCoord[1]);
    const sourceIndex = bounds.value.length / 2 - 1;
    if (mirrorMode.value && Math.abs(relativeCoord[1] || 0) > MIRROR_EPSILON) {
      bounds.value.push(relativeCoord[0], mirrorLateral(relativeCoord[1]));
      mirrorPair.value = { kind: 'bound', i: sourceIndex + 1 };
    } else {
      mirrorPair.value = null;
    }
    selected.value = sourceIndex;
    hovered.value = { kind: 'bound', i: selected.value };
    activeTarget.value = { kind: 'bound', i: selected.value };
    return 'bound';
  }
  if (mode.value === 'bounds' && e.ctrlKey) {
    beginEdit();
    startBoundsInsert(relativeCoord, nearestBoundsSegmentIndex(relativeCoord));
    return 'bound';
  }
  if (mode.value === 'launchBay' && e.ctrlKey) {
    beginEdit();
    addLaunchBayAt(coord);
    return 'launchBayPort';
  }
  if (mode.value === 'launchBay' && e.shiftKey) {
    if (selected.value === null || !selectedSlot.value || str(selectedSlot.value.type).toUpperCase() !== 'LAUNCH_BAY') {
      feedback.warning({
        userMessage: '先选中甲板，再为其新增港口',
        diagnostic: { code: 'ship.deck_required', message: 'A deck must be selected before adding a bay port', location: null },
      });
      return null;
    }
    beginEdit();
    addBayPortAt(relativeCoord);
    return 'launchBayPort';
  }
  if (mode.value === 'weapon' && e.shiftKey) {
    beginEdit();
    copyWeaponSlotAt(coord);
    return 'weapon';
  }
  if (mode.value === 'engine' && e.shiftKey) {
    beginEdit();
    copyEngineAt(coord);
    return 'engine';
  }
  return null;
}
function setField(key: string, value: RowData[string]) {
  localShip.value[key] = value;
  commitEdit();
}
function setVisualField(key: string, value: RowData[string]) {
  localShip.value[key] = value;
  draw();
  commitEdit();
}
function setSlotField(key: string, value: RowData[string]) {
  if (!selectedSlot.value) return;
  selectedSlot.value[key] = value;
  draw();
  commitEdit();
}
function setEngineField(key: string, value: RowData[string]) {
  if (!selectedEngine.value) return;
  selectedEngine.value[key] = value;
  draw();
  commitEdit();
}
function setArray(key: string, idx: number, value: number | null) {
  beginEdit();
  const v = arr(localShip.value[key], [0, 0]);
  v[idx] = value || 0;
  localShip.value[key] = v;
  draw();
  commitEdit();
}
function setSlotLoc(idx: number, value: number | null) {
  if (!selectedSlot.value) return;
  const loc = slotLoc.value;
  loc[idx] = value || 0;
  selectedSlot.value.locations = loc;
  draw();
  commitEdit();
}
function setBayPortCoord(portIndex: number, axis: 0 | 1, value: number | null) {
  if (!selectedSlot.value) return;
  const ports = bayPorts(selectedSlot.value.locations);
  const coord = ports[portIndex] ? [...ports[portIndex]] : [0, 0];
  coord[axis] = value || 0;
  selectedSlot.value.locations = updateBayPort(selectedSlot.value.locations, portIndex, coord);
  draw();
  commitEdit();
}
function removeBayPortAt(portIndex: number) {
  const slot = selectedSlot.value;
  if (!slot) return;
  beginEdit();
  const remaining = removeBayPort(slot.locations, portIndex);
  if (!remaining.length) {
    const bayIndex = selected.value;
    if (bayIndex !== null) weaponSlots.value.splice(bayIndex, 1);
    selected.value = null;
    hovered.value = null;
    activeTarget.value = null;
    inspectorLock.value = null;
    selectedPort.value = null;
  } else {
    slot.locations = remaining;
    selectedPort.value = Math.min(selectedPort.value ?? 0, bayPorts(remaining).length - 1);
  }
  commitEdit();
  draw();
}
function addBayPortFromPanel() {
  const slot = selectedSlot.value;
  if (!slot) return;
  beginEdit();
  const ports = bayPorts(slot.locations);
  const anchor = ports[ports.length - 1] ?? [0, 0];
  slot.locations = appendBayPort(slot.locations, [anchor[0] || 0, anchor[1] || 0]);
  selectedPort.value = ports.length;
  commitEdit();
  draw();
}
function setEngineLoc(idx: number, value: number | null) {
  if (!selectedEngine.value) return;
  const loc = engineLoc.value;
  loc[idx] = value || 0;
  selectedEngine.value.location = loc;
  draw();
  commitEdit();
}
function setBound(idx: number, value: number | null) {
  const b = bounds.value;
  b[idx] = value || 0;
  localShip.value.bounds = b;
  draw();
  commitEdit();
}
function selectInspectorItem(nextMode: typeof mode.value, index: number, kind: string) {
  mode.value = nextMode;
  selected.value = index;
  if (nextMode === 'launchBay') selectedPort.value = null;
  hovered.value = { kind, i: index };
  activeTarget.value = { kind, i: index };
  inspectorLock.value = { kind, i: index };
  draw();
}
function nextWeaponSlotId() {
  const used = new Set<string>();
  for (const slot of weaponSlots.value) {
    const id = str(slot.id);
    if (/^WS\d{4}$/.test(id)) used.add(id);
  }
  return nextFormattedId(used, formatWeaponSlotId);
}
function nextLaunchBayId() {
  const used = new Set<string>();
  for (const item of launchBaySlots.value) {
    const id = str(item.slot.id);
    if (/^LB \d+$/.test(id)) used.add(id);
  }
  return nextFormattedId(used, formatLaunchBayId);
}
function addWeaponSlot() {
  beginEdit();
  weaponSlots.value.push({
    id: nextWeaponSlotId(),
    size: 'MEDIUM',
    type: 'BALLISTIC',
    mount: 'TURRET',
    arc: 120,
    angle: 0,
    locations: [0, 0],
  });
  mode.value = 'weapon';
  selected.value = weaponSlots.value.length - 1;
  commitEdit();
  draw();
}
function addLaunchBay() {
  beginEdit();
  weaponSlots.value.push({
    id: nextLaunchBayId(),
    size: 'LARGE',
    type: 'LAUNCH_BAY',
    mount: 'HIDDEN',
    arc: 360,
    angle: 0,
    locations: [0, 0],
  });
  mode.value = 'launchBay';
  selected.value = weaponSlots.value.length - 1;
  commitEdit();
  draw();
}
function addEngine() {
  beginEdit();
  const sourceIndex = engineSlots.value.length;
  const created = { angle: 180, contrailSize: 12, length: 30, width: 10, location: [-50, 0], style: 'LOW_TECH' };
  engineSlots.value.push(created);
  const engineLocation = arr(created.location, [0, 0]);
  if (mirrorMode.value && Math.abs(engineLocation[1] || 0) > MIRROR_EPSILON) {
    engineSlots.value.push(mirrorEngineForAdd(created));
    mirrorPair.value = { kind: 'engine', i: sourceIndex + 1 };
  } else {
    mirrorPair.value = null;
  }
  mode.value = 'engine';
  selected.value = sourceIndex;
  commitEdit();
  draw();
}
function addBound() {
  beginEdit();
  bounds.value.push(0, 0);
  mode.value = 'bounds';
  selected.value = bounds.value.length / 2 - 1;
  commitEdit();
  draw();
}
function deleteSelected() {
  if (selected.value === null) return false;
  const selectedIndex = selected.value;
  let deleted = false;
  beginEdit();
  if (mode.value === 'weapon' || mode.value === 'launchBay') {
    const isLaunchBay = str(weaponSlots.value[selectedIndex]?.type).toUpperCase() === 'LAUNCH_BAY';
    if ((mode.value === 'weapon' && !isLaunchBay) || (mode.value === 'launchBay' && isLaunchBay)) {
      const pairIndex = mirrorMode.value ? findMirrorWeaponSlotIndex(weaponSlots.value, selectedIndex) : null;
      const indexes = pairIndex === null ? [selectedIndex] : [selectedIndex, pairIndex].sort((a, b) => b - a);
      for (const index of indexes) weaponSlots.value.splice(index, 1);
      deleted = true;
    }
  }
  if (mode.value === 'engine') {
    const pairIndex = mirrorMode.value ? findMirrorEngineIndex(engineSlots.value, selectedIndex) : null;
    const indexes = pairIndex === null ? [selectedIndex] : [selectedIndex, pairIndex].sort((a, b) => b - a);
    for (const index of indexes) engineSlots.value.splice(index, 1);
    deleted = true;
  }
  if (mode.value === 'bounds') {
    const pairIndex = mirrorMode.value ? findMirrorBoundIndex(bounds.value, selectedIndex) : null;
    const indexes = pairIndex === null ? [selectedIndex] : [selectedIndex, pairIndex].sort((a, b) => b - a);
    for (const index of indexes) bounds.value.splice(index * 2, 2);
    deleted = true;
  }
  if (!deleted) return false;
  selected.value = null;
  selectedPort.value = null;
  hovered.value = null;
  activeTarget.value = null;
  inspectorLock.value = null;
  commitEdit();
  draw();
  return true;
}
function builtInWeaponsUpdated(value: RowData) {
  localShip.value.builtInWeapons = value;
  commitEdit();
}
async function pickShipSprite() {
  const accepts = canvas.captureActionContext();
  const relative = await pickModImageReference({ sessionId: props.sessionId, modRoot: props.modRoot, title: '选择舰船贴图', accepts });
  if (!relative) return;
  localShip.value.spriteName = relative;
  commitEdit();
  loadSprite();
}
function save() {
  emit('save-requested');
}
watch(selected, (value) => {
  if (value === null) selectedPort.value = null;
});
watch(() => props.spriteData, loadSprite);
</script>
