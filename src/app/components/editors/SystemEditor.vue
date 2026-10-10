<template>
  <div class="modal-backdrop">
    <div class="projectile-window">
      <EditorHeader
        title="战术系统编辑器"
        :subtitle="systemId"
        :dirty="dirty"
        :external-update-notice="externalUpdateNotice"
        @load-external="$emit('load-external')"
      />
      <div class="projectile-body">
        <n-collapse v-model:expanded-names="expandedSections" :theme-overrides="editorCollapseTheme">
          <n-collapse-item title="基础信息" name="basic">
            <div class="form-grid">
              <label>系统 ID</label><n-input :value="systemId" disabled /> <label>系统类型</label
              ><n-select :value="systemType" :options="toOptions([...SYSTEM_TYPES])" @update:value="onTypeChange" />
              <label>AI 行为类型</label
              ><n-select
                :value="localSystem.aiType"
                :options="toOptions([...AI_TYPES])"
                filterable
                tag
                @update:value="setField('aiType', $event)"
              />
              <label>效果脚本</label><n-input :value="localSystem.statsScript" @update:value="setField('statsScript', $event)" />
              <template v-if="aiType === 'CUSTOM'">
                <label>AI 脚本</label><n-input :value="localSystem.aiScript" @update:value="setField('aiScript', $event)" />
              </template>
            </div>
          </n-collapse-item>

          <n-collapse-item title="行为标志" name="behavior">
            <div class="form-grid">
              <label>暂停时运行脚本</label
              ><n-switch :value="localSystem.runScriptWhilePaused" @update:value="setField('runScriptWhilePaused', $event)" />
              <label>闲置时运行脚本</label
              ><n-switch :value="localSystem.runScriptWhileIdle" @update:value="setField('runScriptWhileIdle', $event)" />
              <label>充能降低时阻止动作</label
              ><n-switch
                :value="localSystem.blockActionsWhileChargingDown"
                @update:value="setField('blockActionsWhileChargingDown', $event)"
              />
              <label>不会导致过载</label
              ><n-switch :value="localSystem.canNotCauseOverload" @update:value="setField('canNotCauseOverload', $event)" />
              <label>右键系统开启时可用</label
              ><n-switch
                :value="localSystem.canUseWhileRightClickSystemOn"
                @update:value="setField('canUseWhileRightClickSystemOn', $event)"
              />
              <label>效果后限制转向</label
              ><n-switch :value="localSystem.clampTurnRateAfter" @update:value="setField('clampTurnRateAfter', $event)" />
              <label>效果后限制速度</label
              ><n-switch :value="localSystem.clampMaxSpeedAfter" @update:value="setField('clampMaxSpeedAfter', $event)" />
              <label>持续加速</label><n-switch :value="localSystem.alwaysAccelerate" @update:value="setField('alwaysAccelerate', $event)" />
              <label>撞击失控概率</label
              ><NumberValueInput
                :value="localSystem.flameoutOnImpactChance"
                :step="0.1"
                @update:value="setField('flameoutOnImpactChance', $event)"
              />
              <label>充能降低时淡出音效</label
              ><n-switch
                :value="localSystem.fadeActivationSoundOnChargedown"
                @update:value="setField('fadeActivationSoundOnChargedown', $event)"
              />
              <label>开盾时取消系统</label
              ><n-switch :value="localSystem.activatingShieldsCancels" @update:value="setField('activatingShieldsCancels', $event)" />
            </div>
          </n-collapse-item>

          <n-collapse-item title="音效" name="sound">
            <div class="form-grid">
              <label>激活音效</label><n-input :value="localSystem.useSound" @update:value="setField('useSound', $event)" />
              <label>循环音效</label><n-input :value="localSystem.loopSound" @update:value="setField('loopSound', $event)" />
              <label>关闭音效</label><n-input :value="localSystem.deactivateSound" @update:value="setField('deactivateSound', $event)" />
              <label>用尽音效</label><n-input :value="localSystem.outOfUsesSound" @update:value="setField('outOfUsesSound', $event)" />
              <label>滤波类型</label
              ><n-select
                :value="localSystem.soundFilterType"
                :options="toOptions(['LOWPASS'])"
                clearable
                @update:value="setField('soundFilterType', $event)"
              />
              <label>滤波增益</label
              ><NumberValueInput :value="localSystem.soundFilterGain" :step="0.05" @update:value="setField('soundFilterGain', $event)" />
              <label>高频滤波增益</label
              ><NumberValueInput
                :value="localSystem.soundFilterGainHF"
                :step="0.05"
                @update:value="setField('soundFilterGainHF', $event)"
              />
            </div>
          </n-collapse-item>

          <n-collapse-item title="引擎视觉" name="engine">
            <div class="form-grid">
              <label>光柱长度倍率</label
              ><NumberValueInput
                :value="localSystem.engineGlowLengthMult"
                :step="0.1"
                @update:value="setField('engineGlowLengthMult', $event)"
              />
              <label>光柱宽度倍率</label
              ><NumberValueInput
                :value="localSystem.engineGlowWidthMult"
                :step="0.1"
                @update:value="setField('engineGlowWidthMult', $event)"
              />
              <label>辉光强度倍率</label
              ><NumberValueInput
                :value="localSystem.engineGlowGlowMult"
                :step="0.1"
                @update:value="setField('engineGlowGlowMult', $event)"
              />
            </div>
            <ColorPicker label="引擎发光颜色" v-model="engineGlowColor" />
            <ColorPicker label="引擎尾迹颜色" v-model="engineGlowContrailColor" />
          </n-collapse-item>

          <n-collapse-item title="武器发光" name="weaponGlow">
            <ColorPicker label="武器发光颜色" v-model="weaponGlowColor" />
            <div class="form-grid">
              <label>受影响武器类型</label
              ><n-select
                :value="localSystem.weaponTypes"
                :options="toOptions(['ENERGY', 'BALLISTIC', 'MISSILE', 'SYSTEM'])"
                multiple
                @update:value="setField('weaponTypes', $event)"
              />
            </div>
          </n-collapse-item>

          <n-collapse-item title="抖动效果" name="jitter">
            <ColorPicker label="抖动颜色" v-model="jitterColor" />
            <div class="form-grid">
              <label>抖动副本数</label
              ><NumberValueInput :value="localSystem.jitterCopies" @update:value="setField('jitterCopies', $event)" />
              <label>最小范围</label
              ><NumberValueInput :value="localSystem.jitterMinRange" @update:value="setField('jitterMinRange', $event)" />
              <label>抖动范围</label><NumberValueInput :value="localSystem.jitterRange" @update:value="setField('jitterRange', $event)" />
              <label>范围半径比例</label
              ><NumberValueInput
                :value="localSystem.jitterRangeRadiusFraction"
                :step="0.1"
                @update:value="setField('jitterRangeRadiusFraction', $event)"
              />
            </div>
            <ColorPicker label="底层抖动颜色" v-model="jitterUnderColor" />
            <div class="form-grid">
              <label>底层副本数</label
              ><NumberValueInput :value="localSystem.jitterUnderCopies" @update:value="setField('jitterUnderCopies', $event)" />
              <label>底层最小范围</label
              ><NumberValueInput :value="localSystem.jitterUnderMinRange" @update:value="setField('jitterUnderMinRange', $event)" />
              <label>底层抖动范围</label
              ><NumberValueInput :value="localSystem.jitterUnderRange" @update:value="setField('jitterUnderRange', $event)" />
              <label>底层范围半径比例</label
              ><NumberValueInput
                :value="localSystem.jitterUnderRangeRadiusFraction"
                :step="0.1"
                @update:value="setField('jitterUnderRangeRadiusFraction', $event)"
              />
            </div>
          </n-collapse-item>

          <n-collapse-item title="效果与相位视觉" name="phase">
            <ColorPicker label="效果颜色 1" v-model="effectColor1" />
            <ColorPicker label="效果颜色 2" v-model="effectColor2" />
            <div class="form-grid">
              <label>高光贴图后缀</label><n-input :value="localSystem.phaseHighlight" @update:value="setField('phaseHighlight', $event)" />
              <label>漫射贴图后缀</label><n-input :value="localSystem.phaseDiffuse" @update:value="setField('phaseDiffuse', $event)" />
              <label>舰船透明度</label
              ><NumberValueInput :value="localSystem.shipAlpha" :step="0.05" @update:value="setField('shipAlpha', $event)" />
            </div>
          </n-collapse-item>

          <n-collapse-item title="护盾视觉" name="shield">
            <ColorPicker label="护盾环颜色" v-model="shieldRingColor" />
            <ColorPicker label="护盾内部颜色" v-model="shieldInnerColor" />
            <div class="form-grid">
              <label>护盾厚度倍率</label
              ><NumberValueInput
                :value="localSystem.shieldThicknessMult"
                :step="0.1"
                @update:value="setField('shieldThicknessMult', $event)"
              />
              <label>护盾波动倍率</label
              ><NumberValueInput
                :value="localSystem.shieldFluctuationMult"
                :step="0.1"
                @update:value="setField('shieldFluctuationMult', $event)"
              />
            </div>
          </n-collapse-item>

          <n-collapse-item v-if="showDisplacerSection" title="位移器参数" name="displacer">
            <div class="form-grid">
              <label>位移距离</label><NumberValueInput :value="localSystem.range" @update:value="setField('range', $event)" />
              <label>随机偏移</label><NumberValueInput :value="localSystem.randomRange" @update:value="setField('randomRange', $event)" />
              <label>传送时渲染副本</label
              ><n-switch :value="localSystem.renderCopyDuringTeleport" @update:value="setField('renderCopyDuringTeleport', $event)" />
            </div>
          </n-collapse-item>

          <n-collapse-item v-if="showWeaponSection" title="武器系统" name="weaponSystem">
            <div class="form-grid">
              <label>关联武器 ID</label><n-input :value="localSystem.weaponDataId" @update:value="setField('weaponDataId', $event)" />
            </div>
          </n-collapse-item>

          <n-collapse-item v-if="showDroneSection" title="无人机参数" name="drone">
            <div class="form-grid">
              <label>无人机装配 ID</label><n-input :value="localSystem.droneVariant" @update:value="setField('droneVariant', $event)" />
              <label>允许自由漫游</label><n-switch :value="localSystem.allowFreeRoam" @update:value="setField('allowFreeRoam', $event)" />
              <label>发射速度</label><NumberValueInput :value="localSystem.launchSpeed" @update:value="setField('launchSpeed', $event)" />
              <label>发射延迟</label
              ><NumberValueInput :value="localSystem.launchDelay" :step="0.1" @update:value="setField('launchDelay', $event)" />
              <label>最大无人机数</label><NumberValueInput :value="localSystem.maxDrones" @update:value="setField('maxDrones', $event)" />
            </div>
            <h4 class="system-editor-heading">无人机行为定义</h4>
            <JsonValueInput :value="localSystem.droneBehavior ?? []" label="droneBehavior" shape="array" @update="droneBehaviorUpdated" />
          </n-collapse-item>

          <n-collapse-item title="伤害（AI 理解用）" name="damage">
            <div class="form-grid">
              <label>EMP 伤害</label><NumberValueInput :value="localSystem.empDamage" @update:value="setField('empDamage', $event)" />
              <label>伤害值</label><NumberValueInput :value="localSystem.damage" @update:value="setField('damage', $event)" />
              <label>伤害类型</label
              ><n-select
                :value="localSystem.damageType"
                :options="toOptions(['ENERGY', 'KINETIC', 'HIGH_EXPLOSIVE', 'FRAGMENTATION'])"
                clearable
                @update:value="setField('damageType', $event)"
              />
            </div>
          </n-collapse-item>

          <n-collapse-item title="AI 提示" name="aiHints">
            <JsonValueInput :value="aiHintsJson" label="aiHints" shape="object" @update="aiHintsJson = $event" />
          </n-collapse-item>

          <n-collapse-item title="额外字段" name="extra">
            <JsonFieldEditor :model-value="extraFields" :known-keys="structuredKnownKeys" @update:model-value="onExtraUpdate" />
          </n-collapse-item>
        </n-collapse>
      </div>
      <EditorFooter note="结构化 JSON 写回，完整保留业务字段。">
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
import ColorPicker from '@/shared/ui/ColorPicker.vue';
import JsonFieldEditor from '@/shared/ui/JsonFieldEditor.vue';
import EditorFooter from '@/app/components/editors/common/EditorFooter.vue';
import EditorHeader from '@/app/components/editors/common/EditorHeader.vue';
import JsonValueInput from '@/shared/ui/JsonValueInput.vue';
import NumberValueInput from '@/shared/ui/NumberValueInput.vue';
import { useFieldInputActions } from '@/app/composables/use-field-input-actions';
import type { JsonValue, RowData, EditContext } from '@/shared/types';
import { arr, str } from '@/shared/lib/starsector';
import { normalizeSystemSpec } from '@/domain/editors/lib/normalize';
import { createSystemSpec } from '@/domain/editors/spec-construction';
import { SYSTEM_STRUCTURED_FIELD_KEYS } from '@/domain/editors/lib/system-fields';
import { SYSTEM_TYPES } from '@/domain/editors/lib/game-spec-enums';
import { useObjectField } from '@/app/composables/editors/use-object-field';
import { editorCollapseTheme, toOptions } from '@/domain/editors/lib/editor-constants';

const props = defineProps<{
  systemId: string;
  system?: RowData;
  editContext: EditContext | null;
  dirty: boolean;
  canSave: boolean;
  saving: boolean;
  externalUpdateNotice: string;
}>();
const emit = defineEmits<{ close: []; 'save-requested': []; 'draft-changed': [system: RowData]; 'load-external': [] }>();

const localSystem = ref<RowData>(normalizeSystemSpec(props.system || createSystemSpec(props.systemId)));
const { commitBefore } = useFieldInputActions();
const expandedSections = ref(['basic']);
const { bindObjectField } = useObjectField(localSystem, { onCommit: commitEdit });

const AI_TYPES = [
  'BURN_DRIVE',
  'BURN_DRIVE_TOGGLE',
  'MANEUVERING_JETS',
  'PHASE_CLOAK',
  'PHASE_DISPLACER',
  'FORTRESS_SHIELD',
  'DAMPER_FIELD',
  'TEMPORAL_SHELL',
  'ACAUSAL_DISRUPTOR',
  'WEAPON_BOOST',
  'FLARE',
  'CANISTER_FLAK',
  'DRONE_LAUNCHER_PD',
  'DRONE_STRIKE',
  'RESERVE_DEPLOYMENT',
  'MOTE_ATTRACTOR',
  'CUSTOM',
  'NONE',
] as const;

const systemType = computed(() => str(localSystem.value.type, 'STAT_MOD'));
const aiType = computed(() => str(localSystem.value.aiType, 'NONE'));
const showDisplacerSection = computed(() => systemType.value === 'DISPLACER' || systemType.value === 'TELEPORTER');
const showWeaponSection = computed(() => systemType.value === 'WEAPON');
const showDroneSection = computed(() => systemType.value === 'DRONE_LAUNCHER');

const engineGlowColor = computed({
  get: () => arr(localSystem.value.engineGlowColor, [255, 175, 125, 255]),
  set: (v) => setField('engineGlowColor', v),
});
const engineGlowContrailColor = computed({
  get: () => arr(localSystem.value.engineGlowContrailColor, [255, 175, 125, 255]),
  set: (v) => setField('engineGlowContrailColor', v),
});
const weaponGlowColor = computed({
  get: () => arr(localSystem.value.weaponGlowColor, [255, 255, 255, 255]),
  set: (v) => setField('weaponGlowColor', v),
});
const jitterColor = computed({
  get: () => arr(localSystem.value.jitterColor, [255, 255, 255, 255]),
  set: (v) => setField('jitterColor', v),
});
const jitterUnderColor = computed({
  get: () => arr(localSystem.value.jitterUnderColor, [255, 255, 255, 255]),
  set: (v) => setField('jitterUnderColor', v),
});
const effectColor1 = computed({
  get: () => arr(localSystem.value.effectColor1, [100, 50, 200, 255]),
  set: (v) => setField('effectColor1', v),
});
const effectColor2 = computed({
  get: () => arr(localSystem.value.effectColor2, [150, 75, 255, 255]),
  set: (v) => setField('effectColor2', v),
});
const shieldRingColor = computed({
  get: () => arr(localSystem.value.shieldRingColor, [100, 200, 255, 255]),
  set: (v) => setField('shieldRingColor', v),
});
const shieldInnerColor = computed({
  get: () => arr(localSystem.value.shieldInnerColor, [100, 200, 255, 75]),
  set: (v) => setField('shieldInnerColor', v),
});

const aiHintsJson = bindObjectField('aiHints');

function commitEdit() {
  emit('draft-changed', localSystem.value);
}
function setField(key: string, value: RowData[string]) {
  localSystem.value[key] = value;
  commitEdit();
}

function droneBehaviorUpdated(value: JsonValue[]) {
  localSystem.value.droneBehavior = value;
  commitEdit();
}

const structuredKnownKeys = [...SYSTEM_STRUCTURED_FIELD_KEYS];

const extraFields = computed<RowData>(() =>
  Object.fromEntries(Object.entries(localSystem.value).filter(([key]) => !SYSTEM_STRUCTURED_FIELD_KEYS.has(key))),
);

function onExtraUpdate(nextExtra: RowData) {
  const structured = Object.fromEntries(Object.entries(localSystem.value).filter(([key]) => SYSTEM_STRUCTURED_FIELD_KEYS.has(key)));
  localSystem.value = { ...structured, ...nextExtra };
  commitEdit();
}

function onTypeChange(newType: string) {
  void commitBefore(() => {
    localSystem.value.type = newType;
    commitEdit();
  });
}

watch(
  () => props.editContext,
  () => {
    if (props.editContext?.handoff === 'save') return;
    localSystem.value = normalizeSystemSpec(props.system || createSystemSpec(props.systemId));
  },
);
</script>
