<template>
  <div class="modal-backdrop">
    <div ref="editorWindowRef" class="editor-window" tabindex="-1">
      <EditorHeader
        title="武器编辑器"
        :subtitle="weaponId"
        :dirty="dirty"
        :external-update-notice="externalUpdateNotice"
        @load-external="$emit('load-external')"
      >
        <div class="ship-mode-controls">
          <div class="segmented ship-mode-tabs">
            <button :class="{ active: viewMode === 'turret' }" @click="setView('turret')">
              炮塔视图 <span class="ship-mode-shortcut">U</span>
            </button>
            <button :class="{ active: viewMode === 'hardpoint' }" @click="setView('hardpoint')">
              固定视图 <span class="ship-mode-shortcut">H</span>
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
        <EditorInspector title="武器检查器">
          <n-collapse
            v-model:expanded-names="expandedSections"
            :theme-overrides="editorCollapseTheme"
            @update:expanded-names="onExpandedSectionsUpdate"
          >
            <n-collapse-item title="基础属性" name="basic">
              <div class="form-grid">
                <label>id</label><n-input :value="weaponId" disabled /> <label>specClass</label
                ><n-select
                  :value="localWeapon.specClass"
                  :options="toOptions(['projectile', 'beam'])"
                  @update:value="setField('specClass', $event)"
                />
                <label>type</label
                ><n-select
                  :value="localWeapon.type"
                  :options="
                    toOptions([
                      'BALLISTIC',
                      'ENERGY',
                      'MISSILE',
                      'HYBRID',
                      'UNIVERSAL',
                      'SYNERGY',
                      'COMPOSITE',
                      'DECORATIVE',
                      'SYSTEM',
                      'BUILT_IN',
                    ])
                  "
                  @update:value="setField('type', $event)"
                />
                <label>size</label
                ><n-select
                  :value="localWeapon.size"
                  :options="toOptions(['SMALL', 'MEDIUM', 'LARGE'])"
                  @update:value="setField('size', $event)"
                />
              </div>
            </n-collapse-item>
            <n-collapse-item title="炮塔贴图" name="turretSprites">
              <div class="form-grid">
                <template v-for="field in turretSpriteFields" :key="field">
                  <label>{{ field }}</label>
                  <div class="sprite-field-row">
                    <n-input :value="localWeapon[field]" @update:value="setField(field, $event)" @change="loadSpriteField(field)" />
                    <n-button
                      class="sprite-icon-button"
                      tertiary
                      title="浏览贴图（引用 Mod 内文件）"
                      aria-label="浏览贴图"
                      @click="pickWeaponSprite(field)"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 19V5h6l2 2h8v12H4z" />
                        <path d="M8 14h8M12 10v8" />
                      </svg>
                    </n-button>
                  </div>
                </template>
              </div>
            </n-collapse-item>
            <n-collapse-item title="固定贴图" name="hardpointSprites">
              <div class="form-grid">
                <template v-for="field in hardpointSpriteFields" :key="field">
                  <label>{{ field }}</label>
                  <div class="sprite-field-row">
                    <n-input :value="localWeapon[field]" @update:value="setField(field, $event)" @change="loadSpriteField(field)" />
                    <n-button
                      class="sprite-icon-button"
                      tertiary
                      title="浏览贴图（引用 Mod 内文件）"
                      aria-label="浏览贴图"
                      @click="pickWeaponSprite(field)"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 19V5h6l2 2h8v12H4z" />
                        <path d="M8 14h8M12 10v8" />
                      </svg>
                    </n-button>
                  </div>
                </template>
              </div>
            </n-collapse-item>
            <n-collapse-item title="炮塔发射点" name="turretBarrels">
              <div class="item-list">
                <button
                  v-for="(_, i) in barrelCountFor('turret')"
                  :key="`barrel-turret-${i}`"
                  :data-inspector-target="`turret-barrel-${i}`"
                  :class="{ selected: viewMode === 'turret' && selected === i }"
                  @click="selectBarrel('turret', i)"
                >
                  发射点 {{ i }}
                  <span>[{{ offsetsFor('turret')[i * 2] }}, {{ offsetsFor('turret')[i * 2 + 1] }}] {{ anglesFor('turret')[i] || 0 }}°</span>
                </button>
              </div>
              <div v-if="viewMode === 'turret' && selected !== null" class="form-grid">
                <label>X</label><n-input-number :value="offsets[selected * 2]" @update:value="setOffset(0, $event)" /> <label>Y</label
                ><n-input-number :value="offsets[selected * 2 + 1]" @update:value="setOffset(1, $event)" /> <label>角度偏移</label
                ><n-input-number :value="angles[selected] || 0" @update:value="setAngle($event)" />
              </div>
              <div class="action-row button-row">
                <n-button @click="addBarrelFor('turret')">添加</n-button
                ><n-button type="error" ghost @click="deleteBarrelFor('turret')">删除</n-button>
              </div>
            </n-collapse-item>
            <n-collapse-item title="固定发射点" name="hardpointBarrels">
              <div class="item-list">
                <button
                  v-for="(_, i) in barrelCountFor('hardpoint')"
                  :key="`barrel-hardpoint-${i}`"
                  :data-inspector-target="`hardpoint-barrel-${i}`"
                  :class="{ selected: viewMode === 'hardpoint' && selected === i }"
                  @click="selectBarrel('hardpoint', i)"
                >
                  发射点 {{ i }}
                  <span
                    >[{{ offsetsFor('hardpoint')[i * 2] }}, {{ offsetsFor('hardpoint')[i * 2 + 1] }}]
                    {{ anglesFor('hardpoint')[i] || 0 }}°</span
                  >
                </button>
              </div>
              <div v-if="viewMode === 'hardpoint' && selected !== null" class="form-grid">
                <label>X</label><n-input-number :value="offsets[selected * 2]" @update:value="setOffset(0, $event)" /> <label>Y</label
                ><n-input-number :value="offsets[selected * 2 + 1]" @update:value="setOffset(1, $event)" /> <label>角度偏移</label
                ><n-input-number :value="angles[selected] || 0" @update:value="setAngle($event)" />
              </div>
              <div class="action-row button-row">
                <n-button @click="addBarrelFor('hardpoint')">添加</n-button
                ><n-button type="error" ghost @click="deleteBarrelFor('hardpoint')">删除</n-button>
              </div>
            </n-collapse-item>
            <n-collapse-item title="发射模式" name="barrelMode">
              <div class="form-grid">
                <label>barrelMode</label
                ><n-select
                  :value="localWeapon.barrelMode"
                  :options="toOptions(['ALTERNATING', 'LINKED'])"
                  @update:value="setField('barrelMode', $event)"
                />
              </div>
            </n-collapse-item>
            <n-collapse-item v-if="localWeapon.specClass === 'projectile'" title="动画" name="anim">
              <div class="form-grid">
                <label>animationType</label
                ><n-select
                  :value="localWeapon.animationType"
                  :options="toOptions(['NONE', 'MUZZLE_FLASH', 'SMOKE', 'GLOW_AND_FLASH', 'GLOW'])"
                  @update:value="setField('animationType', $event)"
                />
                <label>visualRecoil</label
                ><n-input-number :value="localWeapon.visualRecoil" @update:value="setField('visualRecoil', $event)" />
              </div>
              <ObjectEditor
                v-model="muzzleFlashSpec"
                title="muzzleFlashSpec"
                @invalid-json="feedback.warning('muzzleFlashSpec JSON 无效，已保留输入内容')"
              />
              <ObjectEditor v-model="smokeSpec" title="smokeSpec" @invalid-json="feedback.warning('smokeSpec JSON 无效，已保留输入内容')" />
            </n-collapse-item>
            <n-collapse-item v-if="localWeapon.specClass === 'projectile'" title="弹体" name="proj">
              <div class="form-grid">
                <label>projectileSpecId</label>
                <n-auto-complete v-model:value="projectileSpecId" :options="projectileOptions" />
              </div>
              <div class="action-row button-row">
                <n-button @click="$emit('edit-projectile', projectileSpecId)">编辑弹体</n-button>
                <n-button tertiary @click="$emit('preview', weaponId)">发射预览</n-button>
              </div>
            </n-collapse-item>
            <n-collapse-item v-if="localWeapon.specClass === 'beam'" title="光束" name="beam">
              <ColorPicker label="fringeColor" v-model="fringeColor" />
              <ColorPicker label="coreColor" v-model="coreColor" />
              <ColorPicker label="glowColor" v-model="glowColor" />
              <div class="form-grid">
                <label>width</label><n-input-number :value="localWeapon.width" @update:value="setField('width', $event)" />
                <label>textureType</label
                ><n-select
                  :options="toOptions(['ROUGH', 'SMOOTH', 'NONE'])"
                  :value="localWeapon.textureType"
                  @update:value="setField('textureType', $event)"
                />
                <label>textureScrollSpeed</label
                ><n-input-number :value="localWeapon.textureScrollSpeed" @update:value="setField('textureScrollSpeed', $event)" />
                <label>pixelsPerTexel</label
                ><n-input-number :value="localWeapon.pixelsPerTexel" @update:value="setField('pixelsPerTexel', $event)" />
                <label>convergeOnPoint</label
                ><n-checkbox :checked="localWeapon.convergeOnPoint" @update:checked="setField('convergeOnPoint', $event)" />
                <label>darkCore</label><n-checkbox :checked="localWeapon.darkCore" @update:checked="setField('darkCore', $event)" />
              </div>
              <n-button tertiary @click="$emit('preview', weaponId)">预览光束</n-button>
            </n-collapse-item>
            <n-collapse-item title="音效" name="sound">
              <div class="form-grid">
                <label>fireSoundOne</label><n-input :value="localWeapon.fireSoundOne" @update:value="setField('fireSoundOne', $event)" />
                <label>fireSoundTwo</label><n-input :value="localWeapon.fireSoundTwo" @update:value="setField('fireSoundTwo', $event)" />
              </div>
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
import ColorPicker from '@/shared/ui/ColorPicker.vue';
import EditorFooter from '@/app/components/editors/common/EditorFooter.vue';
import EditorHeader from '@/app/components/editors/common/EditorHeader.vue';
import EditorInspector from '@/app/components/editors/common/EditorInspector.vue';
import ObjectEditor from '@/app/components/editors/common/ObjectEditor.vue';
import type { RowData } from '@/shared/types';
import { arr, str } from '@/shared/lib/starsector';
import { normalizeWeaponSpec } from '@/domain/editors/lib/normalize';
import { pointAngleScreen } from '@/domain/editors/lib/geometry';
import {
  useCanvasEditor,
  createCanvasEditorState,
  type CanvasInspectorReveal,
  type CanvasModifiers,
  type CanvasPick,
  type CanvasTarget,
} from '@/app/composables/canvas/use-canvas-editor';
import { useCanvasViewport } from '@/app/composables/canvas/use-canvas-viewport';
import { useObjectField } from '@/app/composables/editors/use-object-field';
import { useResourceReference } from '@/app/composables/editors/use-resource-reference';
import { editorCollapseTheme, snapToStep, toOptions } from '@/domain/editors/lib/editor-constants';
import { drawBarrelVisual, drawCrossMarker, drawWeaponSpriteLayer } from '@/domain/editors/lib/canvas-visuals';
import { findMirrorBarrelIndex, mirrorLateral, mirrorAngleDeg, MIRROR_EPSILON } from '@/domain/editors/lib/mirror';
import {
  HARDPOINT_WEAPON_SPRITE_FIELDS,
  TURRET_WEAPON_SPRITE_FIELDS,
  WEAPON_SPRITE_DRAW_ORDER,
  WEAPON_SPRITE_FIELDS,
  WEAPON_SPRITE_ORIGIN_RATIO,
  weaponAnglesKey,
  weaponOffsetsKey,
  type WeaponSpriteField,
  type WeaponViewMode,
} from '@/domain/editors/lib/weapon-sprite-fields';

type BarrelPreview = { kind: 'add'; coord: { x: number; y: number } } | { kind: 'angle'; angle: number } | null;

const props = defineProps<{
  modRoot: string;
  sessionId: string;
  weaponId: string;
  weapon: RowData;
  spriteData?: Record<string, string>;
  projectileOptions: { label: string; value: string }[];
  draftRevision: number;
  dirty: boolean;
  canSave: boolean;
  saving: boolean;
  externalUpdateNotice: string;
}>();
const emit = defineEmits<{
  close: [];
  'save-requested': [];
  'draft-changed': [weapon: RowData];
  'load-external': [];
  'edit-projectile': [id: string];
  preview: [id: string];
}>();
const feedback = useAppFeedback();
const editorWindowRef = useTemplateRef<HTMLElement>('editorWindowRef');
const stageRef = useTemplateRef<HTMLElement>('stageRef');
const canvasRef = useTemplateRef<HTMLCanvasElement>('canvasRef');
const localWeapon = ref<RowData>(normalizeWeaponSpec(props.weapon));
const viewMode = ref<WeaponViewMode>('turret');
const expandedSections = ref<string[]>(['basic']);
const localSpriteData = ref<Record<string, string>>({ ...(props.spriteData || {}) });
const spriteImages = new Map<string, InstanceType<typeof Image>>();
const viewport = useCanvasViewport(canvasRef, 2, 20);
const { scale } = viewport;
const editorState = createCanvasEditorState<BarrelPreview>();
const { activeTarget, clearPreview, hoverPreview, hovered, inspectorLock, mirrorMode, mirrorPair, selected, setPreview } = editorState;
const canvas = useCanvasEditor({
  stageRef,
  windowRef: editorWindowRef,
  expandedSections,
  viewport,
  state: editorState,
  hooks: {
    value: localWeapon,
    onDraftMutated: (value) => emit('draft-changed', value),
    normalize: normalizeWeaponSpec,
    deleteSelected: deleteSelectedBarrel,
    shortcutKeys: {
      u: () => setView('turret'),
      h: () => setView('hardpoint'),
    },
    inspectorReveal: (): CanvasInspectorReveal | null => ({
      section: currentBarrelSection(),
      selector: selected.value === null ? '' : `[data-inspector-target="${viewMode.value}-barrel-${selected.value}"]`,
      lock: activeTarget.value ? { ...activeTarget.value } : null,
    }),
    selectableTargets,
    hitRadius: () => 26,
    actionDown,
    selectForDown,
    resolveDragKind,
    applyDrag: updateInteraction,
    applyMirrorDrag: applyMirrorDrag,
    captureMirrorPair,
    previewTakesOver: (e) => e.shiftKey || e.ctrlKey,
    computePreview,
    drawPreview,
    cursorMarker,
    mirrorAxisCanvasY: () => toCanvas(0, 0).y,
    onReady: () => loadAllSpriteImages(),
    draw,
  },
});
const {
  commitDraft,
  drawBase,
  drawCursorPosition,
  drawHoverPreview,
  drawMirrorAxis,
  onDown,
  onExpandedSectionsUpdate,
  onLeave,
  onMove,
  onUp,
  onWheel,
  pushUndo,
} = canvas;
const { bindObjectField } = useObjectField(localWeapon, { onCommit: () => commitDraft() });
const { pickModImageReference } = useResourceReference();
const turretSpriteFields = TURRET_WEAPON_SPRITE_FIELDS;
const hardpointSpriteFields = HARDPOINT_WEAPON_SPRITE_FIELDS;
const modeFooterNotes: Record<WeaponViewMode, string> = {
  turret: '左键 拖动发射点 | Shift+左键 添加发射点 | Ctrl+左键 设置角度 | 退格 删除发射点 | T 打开炮塔发射点',
  hardpoint: '左键 拖动发射点 | Shift+左键 添加发射点 | Ctrl+左键 设置角度 | 退格 删除发射点 | T 打开固定发射点',
};
const footerNote = computed(
  () =>
    `右键 拖动画布 | 滚轮缩放 | Ctrl+Z 撤销 | Ctrl+Shift+Z 重做${mirrorMode.value ? '（镜像模式）' : ''}\n${
      modeFooterNotes[viewMode.value]
    }${mirrorMode.value ? ' | 空格 关闭镜像' : ' | 空格 开启镜像'}`,
);

const offsets = computed<number[]>(() => offsetsFor(viewMode.value));
const angles = computed<number[]>(() => anglesFor(viewMode.value));
const barrelCount = computed(() => barrelCountFor(viewMode.value));
const projectileSpecId = computed({
  get: () => str(localWeapon.value.projectileSpecId),
  set: (v) => {
    localWeapon.value.projectileSpecId = v;
    commitDraft();
  },
});
const projectileOptions = computed(() => props.projectileOptions);
const fringeColor = computed({
  get: () => arr(localWeapon.value.fringeColor, [255, 255, 255, 255]),
  set: (v) => {
    localWeapon.value.fringeColor = v;
    commitDraft();
  },
});
const coreColor = computed({
  get: () => arr(localWeapon.value.coreColor, [255, 255, 255, 255]),
  set: (v) => {
    localWeapon.value.coreColor = v;
    commitDraft();
  },
});
const glowColor = computed({
  get: () => arr(localWeapon.value.glowColor, [255, 255, 255, 255]),
  set: (v) => {
    localWeapon.value.glowColor = v;
    commitDraft();
  },
});
const muzzleFlashSpec = bindObjectField('muzzleFlashSpec');
const smokeSpec = bindObjectField('smokeSpec');

function setView(v: WeaponViewMode) {
  viewMode.value = v;
  selected.value = null;
  hovered.value = null;
  activeTarget.value = null;
  inspectorLock.value = null;
  mirrorPair.value = null;
  draw();
}
function setField(key: string, value: RowData[string]) {
  localWeapon.value[key] = value;
  commitDraft();
}
function selectBarrel(mode: WeaponViewMode, index: number) {
  viewMode.value = mode;
  selected.value = index;
  hovered.value = { kind: 'barrel', i: index };
  activeTarget.value = { kind: 'barrel', i: index };
  inspectorLock.value = { kind: 'barrel', i: index };
  draw();
}
function center() {
  return viewport.center();
}
function toCanvas(x: number, y: number) {
  return viewport.toCanvas('ship', x, y);
}
function toWeapon(px: number, py: number) {
  const point = viewport.fromCanvas('ship', px, py);
  return { x: snapToStep(point.x), y: snapToStep(point.y) };
}
function rawToWeapon(px: number, py: number) {
  return viewport.fromCanvas('ship', px, py);
}
function offsetsFor(mode: WeaponViewMode) {
  const key = weaponOffsetsKey(mode);
  if (!Array.isArray(localWeapon.value[key])) localWeapon.value[key] = [];
  return localWeapon.value[key] as number[];
}
function anglesFor(mode: WeaponViewMode) {
  const key = weaponAnglesKey(mode);
  if (!Array.isArray(localWeapon.value[key])) localWeapon.value[key] = [];
  return localWeapon.value[key] as number[];
}
function barrelCountFor(mode: WeaponViewMode) {
  return Math.floor(offsetsFor(mode).length / 2);
}
function currentBarrelSection(): string {
  return viewMode.value === 'turret' ? 'turretBarrels' : 'hardpointBarrels';
}
function spriteDataFor(field: WeaponSpriteField) {
  return localSpriteData.value[field] || '';
}
function setSpriteImage(field: WeaponSpriteField, dataUrl: string) {
  if (!dataUrl) {
    spriteImages.delete(field);
    draw();
    return;
  }
  const image = new Image();
  image.onload = () => draw();
  image.src = dataUrl;
  spriteImages.set(field, image);
}
function loadAllSpriteImages() {
  for (const field of WEAPON_SPRITE_FIELDS) setSpriteImage(field, spriteDataFor(field));
}
function loadSpriteField(field: WeaponSpriteField) {
  setSpriteImage(field, spriteDataFor(field));
  draw();
}
function previewAngle(mx: number, my: number) {
  if (selected.value === null) return 0;
  const origin = { x: offsets.value[selected.value * 2] || 0, y: offsets.value[selected.value * 2 + 1] || 0 };
  return pointAngleScreen(origin, rawToWeapon(mx, my));
}
function computePreview(mx: number, my: number, modifiers: CanvasModifiers): BarrelPreview {
  if (modifiers.shiftKey) {
    return { kind: 'add', coord: toWeapon(mx, my) };
  }
  if (modifiers.ctrlKey && selected.value !== null) {
    return { kind: 'angle', angle: previewAngle(mx, my) };
  }
  return null;
}
function drawPreview(ctx: CanvasRenderingContext2D, preview: NonNullable<BarrelPreview>) {
  ctx.save();
  ctx.globalAlpha = 0.65;
  if (preview.kind === 'add') {
    drawBarrelVisual(ctx, {
      angle: 0,
      hovered: true,
      index: barrelCount.value,
      point: toCanvas(preview.coord.x, preview.coord.y),
      selected: true,
    });
    if (mirrorMode.value && Math.abs(preview.coord.x) > MIRROR_EPSILON) {
      drawBarrelVisual(ctx, {
        angle: 0,
        hovered: true,
        index: barrelCount.value + 1,
        point: toCanvas(mirrorLateral(preview.coord.x), preview.coord.y),
        selected: true,
      });
    }
  }
  if (preview.kind === 'angle' && selected.value !== null) {
    drawBarrelVisual(ctx, {
      angle: preview.angle,
      hovered: true,
      index: selected.value,
      point: toCanvas(offsets.value[selected.value * 2] || 0, offsets.value[selected.value * 2 + 1] || 0),
      selected: true,
    });
  }
  ctx.restore();
}
function cursorLabel(coord: { x: number; y: number }): string {
  if (hoverPreview.value?.kind === 'angle') return `${hoverPreview.value.angle}°`;
  return `${coord.x.toFixed(1)}, ${coord.y.toFixed(1)}`;
}
function cursorMarker(mx: number, my: number) {
  const coord = toWeapon(mx, my);
  return { point: toCanvas(coord.x, coord.y), label: cursorLabel(coord) };
}
function draw() {
  const c = canvasRef.value;
  if (!c) return;
  const ctx = c.getContext('2d')!;
  drawBase(ctx);
  if (mirrorMode.value) drawMirrorAxis(ctx);
  ctx.globalAlpha = 0.72;
  for (const field of WEAPON_SPRITE_DRAW_ORDER[viewMode.value]) {
    const image = spriteImages.get(field);
    if (image) drawSpriteLayer(ctx, image);
  }
  ctx.globalAlpha = 1;
  drawCrossMarker(ctx, center(), true);
  for (let i = 0; i < barrelCount.value; i++) {
    drawBarrelVisual(ctx, {
      angle: angles.value[i] || 0,
      hovered: hovered.value?.kind === 'barrel' && hovered.value.i === i,
      index: i,
      point: toCanvas(offsets.value[i * 2] || 0, offsets.value[i * 2 + 1] || 0),
      selected: selected.value === i,
    });
  }
  drawHoverPreview(ctx);
  drawCursorPosition(ctx);
}
function drawSpriteLayer(ctx: CanvasRenderingContext2D, image: InstanceType<typeof Image>) {
  drawWeaponSpriteLayer(ctx, image, WEAPON_SPRITE_ORIGIN_RATIO[viewMode.value], scale.value, center().x, center().y);
}
function selectableTargets(mx: number, my: number): CanvasTarget[] {
  const targets: CanvasTarget[] = [];
  for (let i = barrelCount.value - 1; i >= 0; i -= 1) {
    const p = toCanvas(offsets.value[i * 2] || 0, offsets.value[i * 2 + 1] || 0);
    targets.push({ kind: 'barrel', i, distance: Math.hypot(mx - p.x, my - p.y) });
  }
  return targets;
}
function selectForDown(e: MouseEvent, mx: number, my: number, pick: CanvasPick): CanvasTarget | null {
  if (e.ctrlKey && selected.value !== null)
    return pick.byIdentity(inspectorLock.value) ?? pick.byIdentity(activeTarget.value) ?? pick.byPointer(mx, my);
  return pick.byIdentity(activeTarget.value) ?? pick.byPointer(mx, my);
}
function resolveDragKind(e: MouseEvent, _mx: number, _my: number, _target: CanvasTarget, selectedAtDown: number | null) {
  if (e.ctrlKey && selectedAtDown !== null) return 'angle';
  return 'offset';
}
function updateInteraction(kind: string, mx: number, my: number) {
  if (kind === 'angle' && selected.value !== null) {
    const angle = previewAngle(mx, my);
    angles.value[selected.value] = angle;
    setPreview({ kind: 'angle', angle });
    return;
  }
  if (kind === 'offset' && selected.value !== null) {
    const coord = toWeapon(mx, my);
    offsets.value[selected.value * 2] = coord.x;
    offsets.value[selected.value * 2 + 1] = coord.y;
  }
}
function captureMirrorPair() {
  mirrorPair.value = null;
  if (!mirrorMode.value || selected.value === null) return;
  const index = findMirrorBarrelIndex(offsets.value, selected.value);
  if (index !== null) mirrorPair.value = { kind: 'barrel', i: index };
}
function applyMirrorDrag(kind: string) {
  if (kind === 'angle') {
    applyMirrorAngle();
    return;
  }
  if (kind === 'offset' && mirrorMode.value && mirrorPair.value !== null && selected.value !== null) {
    const x = offsets.value[selected.value * 2] || 0;
    const y = offsets.value[selected.value * 2 + 1] || 0;
    offsets.value[mirrorPair.value.i * 2] = mirrorLateral(x);
    offsets.value[mirrorPair.value.i * 2 + 1] = y;
  }
}
function applyMirrorAngle() {
  if (!mirrorMode.value || mirrorPair.value === null || selected.value === null) return;
  angles.value[mirrorPair.value.i] = mirrorAngleDeg(angles.value[selected.value] || 0);
}
function setOffset(axis: 0 | 1, value: number | null) {
  if (selected.value === null) return;
  offsets.value[selected.value * 2 + axis] = value || 0;
  draw();
  commitDraft();
}
function setAngle(value: number | null) {
  if (selected.value === null) return;
  angles.value[selected.value] = value || 0;
  draw();
  commitDraft();
}
function addBarrelFor(mode: WeaponViewMode) {
  pushUndo();
  addBarrelAt(mode, { x: 0, y: 0 });
  commitDraft();
  draw();
}
function addBarrelAt(mode: WeaponViewMode, coord: { x: number; y: number }) {
  const nextOffsets = offsetsFor(mode);
  const nextAngles = anglesFor(mode);
  const sourceIndex = Math.floor(nextOffsets.length / 2);
  nextOffsets.push(coord.x, coord.y);
  nextAngles.push(0);
  if (mirrorMode.value && Math.abs(coord.x) > MIRROR_EPSILON) {
    nextOffsets.push(mirrorLateral(coord.x), coord.y);
    nextAngles.push(0);
    mirrorPair.value = { kind: 'barrel', i: sourceIndex + 1 };
  } else {
    mirrorPair.value = null;
  }
  viewMode.value = mode;
  selected.value = sourceIndex;
  hovered.value = { kind: 'barrel', i: selected.value };
  activeTarget.value = { kind: 'barrel', i: selected.value };
  inspectorLock.value = null;
}
function deleteBarrelFor(mode: WeaponViewMode) {
  if (viewMode.value !== mode || selected.value === null) return;
  pushUndo();
  deleteSelectedBarrelData(mode);
  commitDraft();
  draw();
}
function deleteSelectedBarrel(): boolean {
  if (selected.value === null) return false;
  pushUndo();
  deleteSelectedBarrelData(viewMode.value);
  commitDraft();
  draw();
  return true;
}
function deleteSelectedBarrelData(mode: WeaponViewMode) {
  if (selected.value === null) return;
  const selectedIndex = selected.value;
  const pairIndex = mirrorMode.value ? findMirrorBarrelIndex(offsetsFor(mode), selectedIndex) : null;
  const indexes = pairIndex === null ? [selectedIndex] : [selectedIndex, pairIndex].sort((a, b) => b - a);
  for (const index of indexes) {
    offsetsFor(mode).splice(index * 2, 2);
    anglesFor(mode).splice(index, 1);
  }
  mirrorPair.value = null;
  selected.value = null;
  hovered.value = null;
  activeTarget.value = null;
  inspectorLock.value = null;
}
function actionDown(e: MouseEvent, mx: number, my: number) {
  if (!e.shiftKey) return null;
  pushUndo();
  addBarrelAt(viewMode.value, toWeapon(mx, my));
  return 'offset';
}
async function pickWeaponSprite(field: WeaponSpriteField) {
  const relative = await pickModImageReference({ sessionId: props.sessionId, modRoot: props.modRoot, title: '选择武器贴图' });
  if (!relative) return;
  localWeapon.value[field] = relative;
  commitDraft();
}
function save() {
  emit('save-requested');
}
watch(
  () => props.draftRevision,
  () => {
    localWeapon.value = normalizeWeaponSpec(props.weapon);
    selected.value = null;
    hovered.value = null;
    activeTarget.value = null;
    inspectorLock.value = null;
    clearPreview();
  },
);
watch(
  () => props.spriteData,
  (spriteData) => {
    localSpriteData.value = { ...(spriteData || {}) };
    loadAllSpriteImages();
  },
);
</script>
