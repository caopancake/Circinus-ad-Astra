<template>
  <div class="modal-backdrop">
    <div class="preview-window">
      <EditorHeader title="发射预览" :subtitle="previewSubtitle">
        <div class="ship-mode-controls">
          <div class="segmented ship-mode-tabs">
            <button :class="{ active: viewMode === 'turret' }" :disabled="!hasWeaponSpec" @click="setView('turret')">
              炮塔视图 <span class="ship-mode-shortcut">U</span>
            </button>
            <button :class="{ active: viewMode === 'hardpoint' }" :disabled="!hasWeaponSpec" @click="setView('hardpoint')">
              固定视图 <span class="ship-mode-shortcut">H</span>
            </button>
          </div>
        </div>
      </EditorHeader>
      <div class="editor-body">
        <div ref="previewStageRef" class="canvas-stage preview-canvas-stage">
          <canvas ref="canvasRef" class="editor-canvas preview-canvas" />
        </div>
        <EditorInspector title="预览控制">
          <div class="preview-control-panel">
            <section class="preview-control-section">
              <h3>武器状态</h3>
              <div class="preview-control-actions">
                <n-button type="primary" :disabled="firing" @click="startFiring">开火</n-button>
                <n-button :disabled="!firing" @click="stopFiring">停火</n-button>
              </div>
              <div class="preview-fire-status">
                <span>开火状态</span>
                <strong>{{ firing ? '开火中' : '停火' }}</strong>
              </div>
            </section>
            <div class="preview-control-section">
              <h3>预览控制</h3>
              <div class="preview-control-actions">
                <n-button @click="toggle">{{ running ? '暂停' : '播放' }}</n-button>
                <n-button tertiary @click="reset">重置</n-button>
              </div>
              <div class="preview-speed-control">
                <div class="preview-speed-header">
                  <span>播放速度</span>
                  <strong>{{ speedLabel }}</strong>
                </div>
                <n-slider v-model:value="speed" :min="0.5" :max="5" :step="0.1" />
              </div>
            </div>
          </div>
        </EditorInspector>
      </div>
      <EditorFooter note="播放预览用于观察武器弹道和光束表现；右侧可调整播放速度。">
        <template #actions>
          <n-button @click="$emit('close')">关闭</n-button>
        </template>
      </EditorFooter>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useShortcutDispatch } from '@/app/composables/use-shortcut-dispatch';
import { useCanvasSurface, watchCanvasPixelRatio } from '@/app/composables/canvas/use-canvas-surface';
import EditorFooter from '@/app/components/editors/common/EditorFooter.vue';
import EditorHeader from '@/app/components/editors/common/EditorHeader.vue';
import EditorInspector from '@/app/components/editors/common/EditorInspector.vue';
import type { RowData } from '@/shared/types';
import { num, rgba, str } from '@/shared/lib/starsector';
import { drawWeaponSpriteLayer } from '@/domain/editors/lib/canvas-visuals';
import { CANVAS_CLEAR_COLOR, CANVAS_GRID_COLOR } from '@/domain/editors/lib/canvas-palette';
import {
  WEAPON_SPRITE_DRAW_ORDER,
  WEAPON_SPRITE_ORIGIN_RATIO,
  weaponAnglesKey,
  weaponBarrelOffsetsFor,
  type WeaponSpriteField,
  type WeaponViewMode,
} from '@/domain/editors/lib/weapon-sprite-fields';

const props = defineProps<{
  weaponId: string;
  weaponCsvRow: RowData;
  weaponSpec: RowData;
  projectileSpecs: Record<string, RowData>;
  spriteData?: Record<string, string>;
}>();
defineEmits<{ close: [] }>();

const canvasRef = ref<HTMLCanvasElement>();
const previewStageRef = ref<HTMLElement>();
const surface = useCanvasSurface(canvasRef);
let stopPixelRatio: (() => void) | null = null;
const running = ref(true);
const firing = ref(false);
const speed = ref(1);
const viewMode = ref<WeaponViewMode>('turret');
const spriteImages = new Map<WeaponSpriteField, InstanceType<typeof Image>>();
let anim = 0;
let last = 0;
let fireTimer = 0;
let burst = 0;
let barrelIndex = 0;
interface TrailPoint {
  x: number;
  y: number;
}

interface ProjectilePreviewState {
  x: number;
  y: number;
  angle: number;
  speed: number;
  age: number;
  trail: TrailPoint[];
  exploding: boolean;
  explosionAge: number;
  missile: boolean;
}

interface BeamPreviewState {
  alpha: number;
  phase: 'idle' | 'chargeup' | 'burst' | 'chargedown' | 'cooldown';
  length: number;
  offset: number;
  timer: number;
}

interface BarrelState {
  x: number;
  y: number;
  angle: number;
}

let projectiles: ProjectilePreviewState[] = [];
let beam: BeamPreviewState = { alpha: 0, length: 0, offset: 0, phase: 'idle', timer: 0 };
const csv = computed(() => props.weaponCsvRow || {});
const wpn = computed(() => props.weaponSpec || {});
const proj = computed(() => props.projectileSpecs[str(wpn.value.projectileSpecId)] || {});
const hasWeaponSpec = computed(() => Object.keys(props.weaponSpec).length > 0);
const projectileId = computed(() => str(wpn.value.projectileSpecId) || '-');
const previewSubtitle = computed(() => `武器 ${props.weaponId} · 弹体 ${projectileId.value}`);
const speedLabel = computed(() => `${speed.value.toFixed(1)}x`);
const params = computed(() => ({
  specClass: str(wpn.value.specClass, 'projectile'),
  range: num(csv.value.range, 600),
  projSpeed: num(csv.value['proj speed'], 800),
  beamSpeed: num(csv.value['beam speed'], 0),
  hasBurstSize: str(csv.value['burst size']) !== '',
  hasBurstDelay: str(csv.value['burst delay']) !== '',
  burstSize: Math.max(1, num(csv.value['burst size'], 1)),
  burstDelay: num(csv.value['burst delay'], 0),
  chargeup: num(csv.value.chargeup, 0),
  chargedown: num(csv.value.chargedown, 0.5),
  minSpread: num(csv.value['min spread'], 0),
  maxSpread: num(csv.value['max spread'], 0),
  barrelMode: str(wpn.value.barrelMode, 'ALTERNATING'),
  offsets: offsetsFor(viewMode.value),
  angles: anglesFor(viewMode.value),
  beamWidth: num(wpn.value.width, 10),
  fringeColor: wpn.value.fringeColor || [255, 100, 100, 255],
  coreColor: wpn.value.coreColor || [255, 255, 255, 255],
  textureScrollSpeed: num(wpn.value.textureScrollSpeed, 200),
  projLength: num(proj.value.length, 20),
  projWidth: num(proj.value.width, 4),
  projFringeColor: proj.value.fringeColor || [255, 100, 50, 200],
  projCoreColor: proj.value.coreColor || [255, 255, 200, 255],
  spawnType: str(proj.value.spawnType, 'BALLISTIC'),
  missileType: str(proj.value.specClass) === 'missile' ? str(proj.value.missileType, 'MISSILE') : '',
  missileAcc: num((proj.value.engineSpec as RowData)?.acc, 200),
  missileMaxSpeed: num((proj.value.engineSpec as RowData)?.maxSpeed, num(csv.value['proj speed'], 800)),
  missileSize: Array.isArray(proj.value.size) ? (proj.value.size as number[]) : [10, 10],
  explosionRadius: num(proj.value.explosionRadius, 50),
  explosionColor: proj.value.explosionColor || [255, 200, 50, 255],
}));
const barrelCount = computed(() => Math.max(1, Math.floor(params.value.offsets.length / 2)));
const isBurstBeam = computed(
  () => params.value.specClass === 'beam' && params.value.hasBurstSize && params.value.hasBurstDelay && params.value.burstDelay > 0,
);
const spriteOriginRatio = WEAPON_SPRITE_ORIGIN_RATIO;
function offsetsFor(mode: WeaponViewMode) {
  return weaponBarrelOffsetsFor(wpn.value, mode);
}
function anglesFor(mode: WeaponViewMode) {
  const values = wpn.value[weaponAnglesKey(mode)];
  return Array.isArray(values) ? (values as number[]) : [];
}
function setView(mode: WeaponViewMode) {
  if (!hasWeaponSpec.value) return;
  viewMode.value = mode;
  barrelIndex = 0;
  draw();
}
function scalePx() {
  const c = canvasRef.value;
  return c ? (surface.size().width - 140) / Math.max(params.value.range, 100) : 0.5;
}
function rangePx() {
  return params.value.range * scalePx();
}
function reset() {
  projectiles = [];
  resetBeam();
  fireTimer = params.value.chargeup;
  burst = 0;
  barrelIndex = 0;
  last = 0;
  firing.value = false;
  running.value = true;
  restartAnimation();
}
function toggle() {
  running.value = !running.value;
  if (running.value) {
    restartAnimation();
  }
}
function restartAnimation() {
  cancelAnimationFrame(anim);
  last = 0;
  anim = requestAnimationFrame(frame);
}
function startFiring() {
  firing.value = true;
  fireTimer = 0;
  if (params.value.specClass === 'beam') beginBeamCharge();
  if (!running.value) toggle();
}
function stopFiring() {
  firing.value = false;
  if (params.value.specClass === 'beam' && beam.alpha > 0) {
    beam.phase = 'chargedown';
    beam.timer = Math.max(params.value.chargedown, 0.01) * beam.alpha;
  }
}
function resetBeam() {
  beam = { alpha: 0, length: 0, offset: 0, phase: 'idle', timer: 0 };
}
function beginBeamCharge() {
  beam.phase = 'chargeup';
  beam.timer = Math.max(params.value.chargeup, 0.01) * (1 - beam.alpha);
  beam.length = 0;
}
function weaponOrigin() {
  const c = canvasRef.value;
  return { x: 80, y: c ? surface.size().height / 2 : 0 };
}
function barrelAt(index: number): BarrelState | null {
  if (index < 0 || index >= barrelCount.value) return null;
  const p = params.value;
  const origin = weaponOrigin();
  const s = scalePx();
  const bx = p.offsets[index * 2] || 0;
  const by = p.offsets[index * 2 + 1] || 0;
  return {
    x: origin.x + bx * s,
    y: origin.y - by * s,
    angle: p.angles[index] || 0,
  };
}
function fireProjectile(missile = false) {
  const p = params.value;
  const s = scalePx();
  const create = (i: number) => {
    const barrel = barrelAt(i);
    if (!barrel) return;
    const spread = ((p.minSpread + Math.random() * (p.maxSpread - p.minSpread)) * Math.PI) / 180;
    const ang = (barrel.angle * Math.PI) / 180 + (Math.random() - 0.5) * spread;
    projectiles.push({
      x: barrel.x,
      y: barrel.y,
      angle: ang,
      speed: missile ? p.projSpeed * s * 0.3 : p.projSpeed * s,
      age: 0,
      trail: [],
      exploding: false,
      explosionAge: 0,
      missile,
    });
  };
  if (p.barrelMode === 'LINKED') for (let i = 0; i < barrelCount.value; i++) create(i);
  else {
    create(barrelIndex);
    barrelIndex = (barrelIndex + 1) % barrelCount.value;
  }
}
function update(dt: number) {
  const p = params.value;
  if (p.specClass === 'beam') {
    updateBeam(dt);
    return;
  }
  if (!firing.value) {
    updateProjectiles(dt);
    return;
  }
  fireTimer -= dt;
  if (fireTimer <= 0) {
    fireProjectile(Boolean(p.missileType));
    burst++;
    if (burst >= p.burstSize) {
      fireTimer = p.chargedown + p.chargeup;
      burst = 0;
    } else fireTimer = p.burstDelay;
  }
  updateProjectiles(dt);
}
function advanceBeamLength(dt: number) {
  const p = params.value;
  beam.length = p.beamSpeed > 0 ? Math.min(p.range, beam.length + p.beamSpeed * dt) : p.range;
}
function updateBeam(dt: number) {
  const p = params.value;
  beam.offset += p.textureScrollSpeed * dt;
  if (!firing.value && beam.phase !== 'chargedown') {
    if (beam.alpha > 0) {
      beam.phase = 'chargedown';
      beam.timer = Math.max(p.chargedown, 0.01) * beam.alpha;
    } else {
      beam.phase = 'idle';
      return;
    }
  }
  if (firing.value && beam.phase === 'idle') beginBeamCharge();
  if (beam.phase === 'chargeup') {
    const duration = Math.max(p.chargeup, 0.01);
    beam.timer = Math.max(0, beam.timer - dt);
    beam.alpha = Math.min(1, 1 - beam.timer / duration);
    advanceBeamLength(dt);
    if (beam.timer <= 0) {
      beam.alpha = 1;
      beam.phase = 'burst';
      beam.timer = isBurstBeam.value ? p.burstSize : 0;
    }
    return;
  }
  if (beam.phase === 'burst') {
    beam.alpha = 1;
    advanceBeamLength(dt);
    if (isBurstBeam.value) {
      beam.timer = Math.max(0, beam.timer - dt);
      if (beam.timer <= 0) {
        beam.phase = 'chargedown';
        beam.timer = Math.max(p.chargedown, 0.01);
      }
    }
    return;
  }
  if (beam.phase === 'chargedown') {
    const duration = Math.max(p.chargedown, 0.01);
    beam.timer = Math.max(0, beam.timer - dt);
    beam.alpha = Math.max(0, beam.timer / duration);
    if (beam.timer <= 0) {
      beam.alpha = 0;
      beam.phase = firing.value && isBurstBeam.value ? 'cooldown' : 'idle';
      beam.timer = firing.value && isBurstBeam.value ? p.burstDelay : 0;
    }
    return;
  }
  if (beam.phase === 'cooldown') {
    beam.timer = Math.max(0, beam.timer - dt);
    if (beam.timer <= 0 && firing.value) beginBeamCharge();
  }
}
function updateProjectiles(dt: number) {
  const p = params.value;
  const s = scalePx();
  const max = p.missileMaxSpeed * s;
  const acc = p.missileAcc * s;
  for (const obj of projectiles) {
    if (obj.missile) obj.speed = Math.min(max, obj.speed + acc * dt);
    obj.x += Math.cos(obj.angle) * obj.speed * dt;
    obj.y -= Math.sin(obj.angle) * obj.speed * dt;
    obj.age += dt;
    if (obj.missile) {
      obj.trail.push({ x: obj.x, y: obj.y });
      if (obj.trail.length > 30) obj.trail.shift();
      if (obj.x - weaponOrigin().x > rangePx()) obj.exploding = true;
      if (obj.exploding) obj.explosionAge += dt;
    }
  }
  projectiles = projectiles.filter((o) => o.age < 8 && (!o.exploding || o.explosionAge < 0.5));
}
function drawSpriteLayer(ctx: CanvasRenderingContext2D, image: InstanceType<typeof Image>) {
  drawWeaponSpriteLayer(ctx, image, spriteOriginRatio[viewMode.value], scalePx(), weaponOrigin().x, weaponOrigin().y);
}
function drawWeapon(ctx: CanvasRenderingContext2D) {
  const origin = weaponOrigin();
  if (!hasWeaponSpec.value) {
    ctx.fillStyle = '#374151';
    ctx.fillRect(origin.x - 18, origin.y - 12, 36, 24);
    ctx.strokeStyle = '#9ca3af';
    ctx.strokeRect(origin.x - 18, origin.y - 12, 36, 24);
    return;
  }
  for (const field of WEAPON_SPRITE_DRAW_ORDER[viewMode.value]) {
    const image = spriteImages.get(field);
    if (image) drawSpriteLayer(ctx, image);
  }
}
function draw() {
  const c = canvasRef.value;
  if (!c) return;
  const ctx = c.getContext('2d')!;
  const dimensions = surface.size();
  const p = params.value;
  const end = weaponOrigin().x + rangePx();
  ctx.clearRect(0, 0, dimensions.width, dimensions.height);
  ctx.fillStyle = CANVAS_CLEAR_COLOR;
  ctx.fillRect(0, 0, dimensions.width, dimensions.height);
  ctx.strokeStyle = CANVAS_GRID_COLOR;
  for (let x = 80; x < dimensions.width; x += 50) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, dimensions.height);
    ctx.stroke();
  }
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = '#ef444488';
  ctx.beginPath();
  ctx.moveTo(end, 40);
  ctx.lineTo(end, dimensions.height - 40);
  ctx.stroke();
  ctx.setLineDash([]);
  drawWeapon(ctx);
  if (p.specClass === 'beam' && beam.alpha > 0) {
    const beamLength = (p.beamSpeed > 0 ? beam.length : p.range) * scalePx();
    const bw = Math.max(1, p.beamWidth * scalePx() * 0.15);
    for (let i = 0; i < barrelCount.value; i++) {
      const barrel = barrelAt(i);
      if (!barrel) continue;
      ctx.save();
      ctx.translate(barrel.x, barrel.y);
      ctx.rotate((-barrel.angle * Math.PI) / 180);
      ctx.globalAlpha = beam.alpha;
      ctx.fillStyle = rgba(p.fringeColor, 0.65);
      ctx.fillRect(0, -bw, beamLength, bw * 2);
      ctx.fillStyle = rgba(p.coreColor, 0.9);
      ctx.fillRect(0, -bw * 0.4, beamLength, bw * 0.8);
      ctx.restore();
    }
  }
  for (const o of projectiles) {
    if (o.exploding) {
      ctx.beginPath();
      ctx.arc(o.x, o.y, p.explosionRadius * scalePx() * 0.1 * o.explosionAge * 4, 0, Math.PI * 2);
      ctx.fillStyle = rgba(p.explosionColor, 0.5);
      ctx.fill();
      continue;
    }
    if (o.trail?.length > 1) {
      ctx.beginPath();
      ctx.moveTo(o.trail[0]!.x, o.trail[0]!.y);
      for (const t of o.trail) ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = '#f59e0b66';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(-o.angle);
    ctx.fillStyle = o.missile ? '#9ca3af' : rgba(p.projFringeColor, 0.8);
    ctx.fillRect(
      -p.projLength * scalePx() * 0.08,
      -Math.max(2, p.projWidth * scalePx() * 0.1),
      p.projLength * scalePx() * 0.16,
      Math.max(3, p.projWidth * scalePx() * 0.2),
    );
    ctx.fillStyle = o.missile ? '#ef4444' : rgba(p.projCoreColor, 0.95);
    ctx.fillRect(0, -1, Math.max(4, p.projLength * scalePx() * 0.08), 2);
    ctx.restore();
  }
}
function frame(ts: number) {
  if (!running.value) return;
  if (!last) last = ts;
  const dt = Math.min(((ts - last) / 1000) * speed.value, 0.1);
  last = ts;
  update(dt);
  draw();
  anim = requestAnimationFrame(frame);
}
function resize() {
  const c = canvasRef.value;
  if (!c) return;
  const rect = previewStageRef.value?.getBoundingClientRect();
  surface.resize(rect?.width, rect?.height);
  draw();
}
function loadSpriteImages() {
  spriteImages.clear();
  for (const [field, dataUrl] of Object.entries(props.spriteData ?? {}) as [WeaponSpriteField, string][]) {
    if (!dataUrl) continue;
    const image = new Image();
    image.onload = () => draw();
    image.src = dataUrl;
    spriteImages.set(field, image);
  }
}
useShortcutDispatch({
  keys: {
    u: () => setView('turret'),
    h: () => setView('hardpoint'),
  },
});
onMounted(() => {
  stopPixelRatio = watchCanvasPixelRatio(resize);
  loadSpriteImages();
  resize();
  window.addEventListener('resize', resize);
  reset();
});
onUnmounted(() => {
  stopPixelRatio?.();
  cancelAnimationFrame(anim);
  window.removeEventListener('resize', resize);
});
watch(() => props.spriteData, loadSpriteImages);
</script>
