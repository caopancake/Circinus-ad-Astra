<template>
  <div class="color-picker">
    <span v-if="label" class="color-picker-label">{{ label }}</span>
    <n-popover
      v-model:show="panelOpen"
      trigger="manual"
      placement="bottom-start"
      :show-arrow="false"
      :raw="true"
      @clickoutside="cancelPanel"
    >
      <template #trigger>
        <button
          class="color-picker-preview"
          type="button"
          :style="{ '--preview-color': cssColor(currentColor) }"
          title="选择颜色"
          @click="openPanel"
        />
      </template>
      <div class="color-picker-panel" @keydown.stop @keyup.stop @keypress.stop>
        <div
          ref="svRef"
          class="color-picker-sv"
          :style="{ '--hue-color': cssColor({ r: hueRgb.r, g: hueRgb.g, b: hueRgb.b, a: 255 }) }"
          @pointerdown.prevent="startSvDrag"
        >
          <span class="color-picker-sv-handle" :style="{ left: `${draft.s}%`, top: `${100 - draft.v}%` }" />
        </div>
        <div class="color-picker-slider-row">
          <span>H</span>
          <input v-model.number="draft.h" class="color-picker-hue" type="range" min="0" max="360" @input="syncDraftFromHsv" />
        </div>
        <div class="color-picker-slider-row">
          <span>A</span>
          <input v-model.number="draft.a" class="color-picker-alpha" type="range" min="0" max="255" />
          <span class="color-picker-alpha-value">{{ draft.a }}</span>
        </div>
        <div class="color-picker-panel-preview">
          <span class="color-picker-preview small" :style="{ '--preview-color': cssColor(draftColor) }" />
          <span>{{ draftColor.r }}, {{ draftColor.g }}, {{ draftColor.b }}, {{ draftColor.a }}</span>
        </div>
        <div class="color-picker-channels">
          <label v-for="channel in channelKeys" :key="channel">
            <span>{{ channel.toUpperCase() }}</span>
            <NumberValueInput
              class="color-picker-channel-input"
              :input-key="colorKey + '/' + channel"
              :label="(label || '颜色') + ' ' + channel.toUpperCase()"
              :value="channelValue(channel)"
              :min="0"
              :max="255"
              :show-button="false"
              :disabled="props.channels === 'rgb' && channel === 'a'"
              size="small"
              @update:value="updateChannel(channel, $event)"
            />
          </label>
        </div>
        <div class="color-picker-actions">
          <span v-if="panelError" class="color-picker-error">{{ panelError }}</span>
          <n-button size="tiny" quaternary @click="cancelPanel">取消</n-button>
          <n-button size="tiny" type="primary" @click="confirmPanel">确认</n-button>
        </div>
      </div>
    </n-popover>
    <n-input
      v-if="allowTextInput"
      ref="textInput"
      class="color-picker-text-input"
      :value="textDraft"
      size="small"
      :status="textValid ? undefined : 'error'"
      :disabled="panelOpen"
      placeholder="#RRGGBB / rgba(...) / [r,g,b,a]"
      @update:value="updateTextDraft"
      @blur="commitTextDraft"
      @keyup.enter="commitTextDraft"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, getCurrentInstance, onScopeDispose, onUnmounted, reactive, ref, useTemplateRef, watch } from 'vue';
import type { JsonValue } from '@/shared/types';
import { createFieldInputs, provideFieldInputs, registerFieldInput, useFieldInputs } from '@/shared/runtime/field-inputs';
import NumberValueInput from '@/shared/ui/NumberValueInput.vue';
import { formatError } from '@/shared/lib/errors';
import { focusFieldInput } from '@/shared/runtime/focus-field-input';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import { cell } from '@/shared/lib/starsector';

type ChannelMode = 'rgb' | 'rgba';
type ChannelKey = 'r' | 'g' | 'b' | 'a';
type ColorOutput = 'rgb-array' | 'rgba-array' | 'hex-rgb' | 'hex-rgba' | 'css-rgb' | 'css-rgba';

interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface HsvDraft {
  h: number;
  s: number;
  v: number;
  a: number;
}

const props = withDefaults(
  defineProps<{
    channels?: ChannelMode;
    output?: ColorOutput;
    label?: string;
    inputKey?: string;
    defaultValue?: number[];
    allowTextInput?: boolean;
  }>(),
  {
    channels: 'rgba',
    output: 'rgba-array',
    label: '',
    inputKey: undefined,
    defaultValue: () => [128, 128, 128, 255],
    allowTextInput: true,
  },
);

const modelValue = defineModel<JsonValue | number[]>('modelValue', { default: () => [] });

const panelOpen = ref(false);
const colorKey = props.inputKey ?? (props.label || 'color/' + getCurrentInstance()!.uid);
const controls = useFieldInputs() ?? provideFieldInputs(createFieldInputs());
const panelError = ref('');
const svRef = useTemplateRef<HTMLElement>('svRef');
const textDraft = ref('');
const textBaseline = ref('');
const textInput = ref<{ inputElRef: HTMLInputElement | null; focus: () => void } | null>(null);
const textValid = ref(true);
const draft = reactive<HsvDraft>({ h: 0, s: 0, v: 0, a: 255 });
const channelKeys: ChannelKey[] = ['r', 'g', 'b', 'a'];
const effectiveOutput = computed<ColorOutput>(() =>
  props.output === 'rgba-array' && props.channels === 'rgb' ? 'rgb-array' : props.output,
);

const currentColor = computed<RgbaColor>(() => parseColor(modelValue.value, arrayToRgba(props.defaultValue, props.defaultValue))!);
const hueRgb = computed(() => hsvToRgb(draft.h, 100, 100));
const draftColor = computed<RgbaColor>(() => ({ ...hsvToRgb(draft.h, draft.s, draft.v), a: clampChannel(draft.a) }));
const panelBaseline = ref<RgbaColor>({ ...draftColor.value });
const textDirty = computed(() => textDraft.value !== textBaseline.value);
const inputDirty = computed(
  () =>
    textDirty.value || controls.dirtyDescendants(colorKey) || (panelOpen.value && !stableDeepEqual(draftColor.value, panelBaseline.value)),
);

watch(
  currentColor,
  (color) => {
    if (!panelOpen.value) loadDraft(color);
    if (!textDirty.value) {
      textDraft.value = String(formatColor(color, effectiveOutput.value));
      textBaseline.value = textDraft.value;
      textValid.value = true;
    }
  },
  { immediate: true },
);

function openPanel() {
  panelError.value = '';
  if (commitTextDraft() !== null) return;
  loadDraft(currentColor.value);
  panelBaseline.value = { ...draftColor.value };
  panelOpen.value = true;
}

function cancelPanel() {
  panelOpen.value = false;
  loadDraft(currentColor.value);
  stopSvDrag();
}

function applyPanel() {
  if (!stableDeepEqual(draftColor.value, panelBaseline.value)) emitColor(draftColor.value);
  panelOpen.value = false;
  stopSvDrag();
}

async function confirmPanel() {
  try {
    const pending = controls.commit(colorKey);
    if (pending) await pending;
  } catch (error) {
    panelError.value = formatError(error);
  }
}
onScopeDispose(
  controls.registerFinalizer(() => {
    if (panelOpen.value) applyPanel();
  }, colorKey),
);

function updateChannel(channel: ChannelKey, value: number | null) {
  const next = { ...draftColor.value, [channel]: clampChannel(value ?? 0) };
  if (channel === 'a') {
    draft.a = props.channels === 'rgb' ? 255 : next.a;
    return;
  }
  loadDraft(next);
}

function channelValue(channel: ChannelKey): number {
  if (props.channels === 'rgb' && channel === 'a') return 255;
  return panelOpen.value ? draftColor.value[channel] : currentColor.value[channel];
}

function emitColor(color: RgbaColor) {
  const normalized = { ...color, a: props.channels === 'rgb' ? 255 : color.a };
  modelValue.value = formatColor(normalized, effectiveOutput.value);
  textDraft.value = String(modelValue.value);
  textBaseline.value = textDraft.value;
  textValid.value = true;
}

function loadDraft(color: RgbaColor) {
  const hsv = rgbToHsv(color.r, color.g, color.b);
  draft.h = hsv.h;
  draft.s = hsv.s;
  draft.v = hsv.v;
  draft.a = props.channels === 'rgb' ? 255 : color.a;
}

function syncDraftFromHsv() {
  draft.h = clamp(Number(draft.h) || 0, 0, 360);
}

interface PointerLike {
  clientX: number;
  clientY: number;
}

function startSvDrag(event: PointerLike) {
  setSvFromEvent(event);
  window.addEventListener('pointermove', setSvFromEvent);
  window.addEventListener('pointerup', stopSvDrag, { once: true });
}

function setSvFromEvent(event: Event | PointerLike) {
  const pointer = event as PointerLike;
  const rect = svRef.value?.getBoundingClientRect();
  if (!rect) return;
  const x = clamp(pointer.clientX - rect.left, 0, rect.width);
  const y = clamp(pointer.clientY - rect.top, 0, rect.height);
  draft.s = Math.round((x / rect.width) * 100);
  draft.v = Math.round(100 - (y / rect.height) * 100);
}

function stopSvDrag() {
  window.removeEventListener('pointermove', setSvFromEvent);
  window.removeEventListener('pointerup', stopSvDrag);
}

function updateTextDraft(value: string) {
  textDraft.value = value;
  textValid.value = parseColor(value, null) !== null;
}

function commitTextDraft(): string | null {
  if (!textDirty.value) return null;
  const parsed = parseColor(textDraft.value, null);
  if (!parsed) {
    textValid.value = false;
    return '请输入有效颜色';
  }
  textValid.value = true;
  emitColor(parsed);
  return null;
}

registerFieldInput({
  key: colorKey,
  label: props.label || '颜色',
  dirty: inputDirty,
  commit: () => {
    if (panelOpen.value) {
      return null;
    }
    return commitTextDraft();
  },
  focus: async () => {
    await focusFieldInput(textInput.value?.inputElRef ?? null);
    textInput.value?.focus();
  },
  cancel: () => {
    cancelPanel();
    textDraft.value = String(formatColor(currentColor.value, effectiveOutput.value));
    textBaseline.value = textDraft.value;
    textValid.value = true;
  },
});

function arrayToRgba(value: unknown, fallback: number[]): RgbaColor {
  const source = Array.isArray(value) ? value : fallback;
  return {
    r: clampChannel(Number(cell(source[0] ?? fallback[0] ?? 128))),
    g: clampChannel(Number(cell(source[1] ?? fallback[1] ?? 128))),
    b: clampChannel(Number(cell(source[2] ?? fallback[2] ?? 128))),
    a: props.channels === 'rgb' ? 255 : clampChannel(Number(cell(source[3] ?? fallback[3] ?? 255))),
  };
}

function parseColor(value: unknown, fallback: RgbaColor | null): RgbaColor | null {
  if (Array.isArray(value)) return arrayToRgba(value, props.defaultValue);
  if (typeof value === 'number') return numberToRgba(value);
  if (typeof value === 'string') {
    const parsed = parseColorString(value);
    return parsed ?? fallback;
  }
  return fallback;
}

function parseColorString(value: string): RgbaColor | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const bracket = parseArrayString(trimmed);
  if (bracket) return bracket;
  const css = parseCssColor(trimmed);
  if (css) return css;
  const hex = parseHexColor(trimmed);
  if (hex) return hex;
  const numeric = parseNumericColor(trimmed);
  if (numeric) return numeric;
  return null;
}

function parseArrayString(value: string): RgbaColor | null {
  if (!value.startsWith('[') || !value.endsWith(']')) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || (parsed.length !== 3 && parsed.length !== 4)) return null;
    if (!parsed.every((channel) => typeof channel === 'number' && Number.isFinite(channel))) return null;
    return arrayToRgba(parsed, props.defaultValue);
  } catch {
    return null;
  }
}

function parseCssColor(value: string): RgbaColor | null {
  const match = value.match(/^rgba?\((.+)\)$/i);
  const args = match?.[1];
  if (!args) return null;
  const parts = args.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const r = parseCssChannel(parts[0] ?? '');
  const g = parseCssChannel(parts[1] ?? '');
  const b = parseCssChannel(parts[2] ?? '');
  const a = parts[3] === undefined ? 255 : parseAlpha(parts[3]);
  if ([r, g, b, a].some((part) => part === null)) return null;
  return { r: r!, g: g!, b: b!, a: a! };
}

function parseCssChannel(value: string): number | null {
  if (value.endsWith('%')) {
    const percent = Number(value.slice(0, -1));
    return Number.isFinite(percent) ? clampChannel((percent / 100) * 255) : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clampChannel(parsed) : null;
}

function parseAlpha(value: string): number | null {
  if (value.endsWith('%')) {
    const percent = Number(value.slice(0, -1));
    return Number.isFinite(percent) ? clampChannel((percent / 100) * 255) : null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed <= 1 ? clampChannel(parsed * 255) : clampChannel(parsed);
}

function parseHexColor(value: string): RgbaColor | null {
  const raw = value.startsWith('#') ? value.slice(1) : value;
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(raw)) return null;
  return {
    r: parseInt(raw.slice(0, 2), 16),
    g: parseInt(raw.slice(2, 4), 16),
    b: parseInt(raw.slice(4, 6), 16),
    a: raw.length === 8 ? parseInt(raw.slice(6, 8), 16) : 255,
  };
}

function parseNumericColor(value: string): RgbaColor | null {
  if (/^0x[0-9a-fA-F]+$/i.test(value)) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numberToRgba(numeric) : null;
  }
  if (!/^\d+$/.test(value)) return null;
  if (value.length === 6 || value.length === 8) return parseHexColor(value);
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numberToRgba(numeric) : null;
}

function numberToRgba(value: number): RgbaColor {
  const normalized = Math.max(0, Math.min(0xffffffff, Math.floor(value)));
  const hasAlpha = normalized > 0xffffff;
  return {
    r: (normalized >> (hasAlpha ? 24 : 16)) & 0xff,
    g: (normalized >> (hasAlpha ? 16 : 8)) & 0xff,
    b: (normalized >> (hasAlpha ? 8 : 0)) & 0xff,
    a: hasAlpha ? normalized & 0xff : 255,
  };
}

function formatColor(color: RgbaColor, output: ColorOutput): number[] | string {
  const rgba = [color.r, color.g, color.b, props.channels === 'rgb' ? 255 : color.a].map(clampChannel);
  const [r = 0, g = 0, b = 0, a = 255] = rgba;
  switch (output) {
    case 'rgb-array':
      return rgba.slice(0, 3);
    case 'rgba-array':
      return rgba;
    case 'hex-rgb':
      return `#${rgba.slice(0, 3).map(toHex).join('')}`;
    case 'hex-rgba':
      return `#${rgba.map(toHex).join('')}`;
    case 'css-rgb':
      return `rgb(${r}, ${g}, ${b})`;
    case 'css-rgba':
      return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
  }
}

function toHex(value: number): string {
  return clampChannel(value).toString(16).padStart(2, '0');
}

function cssColor(color: RgbaColor): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a / 255})`;
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / delta + 2);
    else h = 60 * ((rn - gn) / delta + 4);
  }
  if (h < 0) h += 360;
  return {
    h: Math.round(h),
    s: max === 0 ? 0 : Math.round((delta / max) * 100),
    v: Math.round(max * 100),
  };
}

function hsvToRgb(h: number, s: number, v: number): Omit<RgbaColor, 'a'> {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 100) / 100;
  const val = clamp(v, 0, 100) / 100;
  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;
  let rgb: [number, number, number];
  if (hue < 60) rgb = [c, x, 0];
  else if (hue < 120) rgb = [x, c, 0];
  else if (hue < 180) rgb = [0, c, x];
  else if (hue < 240) rgb = [0, x, c];
  else if (hue < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const [r, g, b] = rgb;
  return {
    r: clampChannel((r + m) * 255),
    g: clampChannel((g + m) * 255),
    b: clampChannel((b + m) * 255),
  };
}

function clampChannel(value: number): number {
  return Math.round(clamp(Number.isFinite(value) ? value : 0, 0, 255));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

onUnmounted(stopSvDrag);
</script>
