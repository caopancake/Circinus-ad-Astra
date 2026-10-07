<template>
  <div class="modal-backdrop">
    <div class="projectile-window">
      <EditorHeader
        title="弹体编辑器"
        :subtitle="projectileId"
        :dirty="dirty"
        :external-update-notice="externalUpdateNotice"
        @load-external="$emit('load-external')"
      />
      <div class="projectile-body">
        <n-collapse v-model:expanded-names="expandedSections" :theme-overrides="editorCollapseTheme">
          <n-collapse-item title="基础属性" name="basic">
            <div class="form-grid">
              <label>id</label><n-input :value="projectileId" disabled /> <label>specClass</label
              ><n-select
                :value="localProjectile.specClass"
                :options="toOptions(['projectile', 'missile'])"
                @update:value="setField('specClass', $event)"
              />
            </div>
          </n-collapse-item>
          <template v-if="specClass === 'projectile'">
            <n-collapse-item title="弹体外观" name="visual">
              <div class="form-grid">
                <label>spawnType</label
                ><n-select
                  :options="toOptions([...PROJECTILE_SPAWN_TYPES])"
                  :value="localProjectile.spawnType"
                  @update:value="setField('spawnType', $event)"
                />
                <label>bulletSprite</label
                ><n-input :value="localProjectile.bulletSprite" @update:value="setField('bulletSprite', $event)" /> <label>length</label
                ><n-input-number :value="localProjectile.length" @update:value="setField('length', $event)" /> <label>width</label
                ><n-input-number :value="localProjectile.width" @update:value="setField('width', $event)" />
                <label>textureScrollSpeed</label
                ><n-input-number :value="localProjectile.textureScrollSpeed" @update:value="setField('textureScrollSpeed', $event)" />
                <label>pixelsPerTexel</label
                ><n-input-number :value="localProjectile.pixelsPerTexel" @update:value="setField('pixelsPerTexel', $event)" />
              </div>
              <ColorPicker label="fringeColor" v-model="fringeColor" />
              <ColorPicker label="coreColor" v-model="coreColor" />
              <n-button size="small" tertiary @click="pickProjectileSprite('bulletSprite')">浏览贴图（引用 Mod 内文件）</n-button>
            </n-collapse-item>
            <n-collapse-item title="碰撞与消散" name="collision">
              <div class="form-grid">
                <label>collisionClass</label
                ><n-select
                  :options="
                    toOptions([
                      'PROJECTILE_NO_FF',
                      'PROJECTILE_FF',
                      'PROJECTILE_FIGHTER',
                      'MISSILE_NO_FF',
                      'MISSILE_FF',
                      'RAY',
                      'RAY_FIGHTER',
                      'HITS_SHIPS_AND_ASTEROIDS',
                      'NONE',
                    ])
                  "
                  :value="localProjectile.collisionClass"
                  @update:value="setField('collisionClass', $event)"
                />
                <label>collisionClassByFighter</label
                ><n-input :value="localProjectile.collisionClassByFighter" @update:value="setField('collisionClassByFighter', $event)" />
                <label>fadeTime</label><n-input-number :value="localProjectile.fadeTime" @update:value="setField('fadeTime', $event)" />
                <label>hitGlowRadius</label
                ><n-input-number :value="localProjectile.hitGlowRadius" @update:value="setField('hitGlowRadius', $event)" />
              </div>
            </n-collapse-item>
          </template>
          <template v-else-if="specClass === 'missile'">
            <n-collapse-item title="导弹外观" name="missileVisual">
              <div class="form-grid">
                <label>missileType</label
                ><n-select
                  :value="localProjectile.missileType"
                  :options="toOptions([...MISSILE_TYPES])"
                  @update:value="setField('missileType', $event)"
                />
                <label>sprite</label><n-input :value="localProjectile.sprite" @update:value="setField('sprite', $event)" />
                <label>size W</label><n-input-number :value="size[0]" @update:value="setArray('size', 0, $event)" /> <label>size H</label
                ><n-input-number :value="size[1]" @update:value="setArray('size', 1, $event)" /> <label>center X</label
                ><n-input-number :value="center[0]" @update:value="setArray('center', 0, $event)" /> <label>center Y</label
                ><n-input-number :value="center[1]" @update:value="setArray('center', 1, $event)" /> <label>collisionRadius</label
                ><n-input-number :value="localProjectile.collisionRadius" @update:value="setField('collisionRadius', $event)" />
              </div>
              <ColorPicker label="explosionColor" v-model="explosionColor" />
              <n-button size="small" tertiary @click="pickProjectileSprite('sprite')">浏览贴图（引用 Mod 内文件）</n-button>
            </n-collapse-item>
            <n-collapse-item title="引擎参数" name="engine">
              <ObjectEditor v-model="engineSpec" @invalid-json="feedback.warning('engineSpec JSON 无效，已保留输入内容')" />
            </n-collapse-item>
            <n-collapse-item title="引擎槽位" name="slots">
              <div class="bounds-list">
                <div v-for="(slot, i) in engineSlots" :key="entryKey('engine-slot', slot, i)">
                  <span>{{ i }}</span>
                  <n-input-number :value="slotLoc(slot)[0]" @update:value="setSlotLoc(i, 0, $event)" />
                  <n-input-number :value="slotLoc(slot)[1]" @update:value="setSlotLoc(i, 1, $event)" />
                  <n-button size="tiny" type="error" ghost @click="removeEngineSlot(i)">删除</n-button>
                </div>
              </div>
              <n-button @click="addEngineSlot">添加引擎槽</n-button>
            </n-collapse-item>
            <n-collapse-item title="爆炸与时间" name="explosion">
              <div class="form-grid">
                <label>explosionRadius</label
                ><n-input-number :value="localProjectile.explosionRadius" @update:value="setField('explosionRadius', $event)" />
                <label>flameoutTime</label
                ><n-input-number :value="localProjectile.flameoutTime" @update:value="setField('flameoutTime', $event)" />
                <label>armingTime</label
                ><n-input-number :value="localProjectile.armingTime" @update:value="setField('armingTime', $event)" />
                <label>fadeTime</label><n-input-number :value="localProjectile.fadeTime" @update:value="setField('fadeTime', $event)" />
              </div>
              <ObjectEditor v-model="explosionSpec" @invalid-json="feedback.warning('explosionSpec JSON 无效，已保留输入内容')" />
            </n-collapse-item>
          </template>
          <n-collapse-item v-else title="通用属性" name="generic">
            <ObjectEditor
              :model-value="localProjectile"
              :parse="(text: string) => normalizeProjectileSpec(JSON.parse(text || '{}'))"
              @update:model-value="projectileUpdated"
              @invalid-json="feedback.warning('JSON 无效，已保留输入内容')"
            />
          </n-collapse-item>
        </n-collapse>
      </div>
      <EditorFooter note="结构化 JSON 写回，内部字段会被后端剔除。">
        <template #actions>
          <n-button @click="$emit('close')">关闭</n-button>
          <n-button type="primary" :disabled="!canSave" :loading="saving" @click="emit('save-requested')">保存</n-button>
        </template>
      </EditorFooter>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import ColorPicker from '@/shared/ui/ColorPicker.vue';
import EditorFooter from '@/app/components/editors/common/EditorFooter.vue';
import EditorHeader from '@/app/components/editors/common/EditorHeader.vue';
import ObjectEditor from '@/app/components/editors/common/ObjectEditor.vue';
import type { RowData } from '@/shared/types';
import { arr, str } from '@/shared/lib/starsector';
import { entryKey } from '@/shared/lib/entry-keys';
import { normalizeProjectileSpec } from '@/domain/editors/lib/normalize';
import { MISSILE_TYPES, PROJECTILE_SPAWN_TYPES } from '@/domain/editors/lib/game-spec-enums';
import { createProjectileEngineSlot } from '@/domain/editors/lib/projectile-fields';
import { useObjectField } from '@/app/composables/editors/use-object-field';
import { useResourceReference } from '@/app/composables/editors/use-resource-reference';
import { editorCollapseTheme, toOptions } from '@/domain/editors/lib/editor-constants';

const props = defineProps<{
  modRoot: string;
  sessionId: string;
  projectileId: string;
  projectile?: RowData;
  draftRevision: number;
  dirty: boolean;
  canSave: boolean;
  saving: boolean;
  externalUpdateNotice: string;
}>();
const emit = defineEmits<{
  close: [];
  'save-requested': [];
  'draft-changed': [projectile: RowData];
  'load-external': [];
}>();
const feedback = useAppFeedback();
const localProjectile = ref<RowData>(normalizeProjectileSpec(props.projectile || { id: props.projectileId, specClass: 'projectile' }));
const expandedSections = ref(['basic']);
const { bindObjectField } = useObjectField(localProjectile, { onCommit: commitDraft });
const { pickModImageReference } = useResourceReference();
const specClass = computed(() => str(localProjectile.value.specClass, 'projectile'));
const size = computed(() => arr(localProjectile.value.size, [0, 0]));
const center = computed(() => arr(localProjectile.value.center, [0, 0]));
const engineSlots = computed<RowData[]>(() =>
  Array.isArray(localProjectile.value.engineSlots) ? (localProjectile.value.engineSlots as RowData[]) : [],
);
const fringeColor = computed({
  get: () => arr(localProjectile.value.fringeColor, [255, 255, 255, 255]),
  set: (v) => setField('fringeColor', v),
});
const coreColor = computed({
  get: () => arr(localProjectile.value.coreColor, [255, 255, 255, 255]),
  set: (v) => setField('coreColor', v),
});
const explosionColor = computed({
  get: () => arr(localProjectile.value.explosionColor, [255, 200, 50, 255]),
  set: (v) => setField('explosionColor', v),
});
const engineSpec = bindObjectField('engineSpec');
const explosionSpec = bindObjectField('explosionSpec');

function commitDraft() {
  emit('draft-changed', localProjectile.value);
}
function setField(key: string, value: RowData[string]) {
  localProjectile.value[key] = value;
  commitDraft();
}
function setArray(key: string, idx: number, value: number | null) {
  const v = arr(localProjectile.value[key], [0, 0]);
  v[idx] = value || 0;
  localProjectile.value[key] = v;
  commitDraft();
}
function slotLoc(slot: RowData) {
  return arr(slot.loc, [0, 0]);
}
function setSlotLoc(i: number, axis: number, value: number | null) {
  const slot = engineSlots.value[i];
  if (!slot) return;
  const loc = slotLoc(slot);
  loc[axis] = value || 0;
  slot.loc = loc;
  commitDraft();
}
function addEngineSlot() {
  engineSlots.value.push(createProjectileEngineSlot(engineSlots.value));
  commitDraft();
}
function removeEngineSlot(i: number) {
  engineSlots.value.splice(i, 1);
  commitDraft();
}
function projectileUpdated(value: unknown) {
  localProjectile.value = normalizeProjectileSpec(value as RowData);
  commitDraft();
}
async function pickProjectileSprite(field: 'bulletSprite' | 'sprite') {
  const relative = await pickModImageReference({ sessionId: props.sessionId, modRoot: props.modRoot, title: '选择弹体贴图' });
  if (!relative) return;
  setField(field, relative);
}
watch(
  () => props.draftRevision,
  () => {
    localProjectile.value = normalizeProjectileSpec(props.projectile || { id: props.projectileId, specClass: 'projectile' });
  },
);
</script>
