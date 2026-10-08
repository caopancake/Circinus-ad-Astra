<template>
  <div class="json-field-editor">
    <div v-for="key in extraKeys" :key="key" class="json-field-row">
      <span class="json-field-key">{{ key }}</span>
      <n-input
        v-if="typeof model[key] === 'string' || model[key] === null || model[key] === undefined"
        :value="String(model[key] ?? '')"
        size="small"
        @update:value="updateField(key, $event)"
      />
      <n-input-number
        v-else-if="typeof model[key] === 'number'"
        :value="model[key] as number"
        :show-button="false"
        size="small"
        @update:value="updateField(key, $event ?? 0)"
      />
      <n-switch
        v-else-if="typeof model[key] === 'boolean'"
        class="tool-switch field-switch"
        :value="model[key] as boolean"
        size="small"
        @update:value="updateField(key, $event)"
      />
      <JsonValueInput
        v-else
        :value="model[key]"
        :label="key"
        :shape="Array.isArray(model[key]) ? 'array' : 'object'"
        @update="updateField(key, $event)"
      />
      <n-button class="compact-icon-button" size="tiny" quaternary title="删除字段" @click="removeField(key)">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </n-button>
    </div>
    <div v-if="extraKeys.length === 0" class="json-field-empty">无额外字段</div>
    <div class="json-field-add">
      <n-input v-model:value="newKey" class="json-field-new-key" size="small" placeholder="新字段名" />
      <n-button size="small" :disabled="!newKey.trim()" @click="addField">添加</n-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { isInternalJsonFieldKey } from '@/shared/lib/json-fields';
import type { JsonValue, RowData } from '@/shared/types';
import JsonValueInput from '@/shared/ui/JsonValueInput.vue';
import { useFieldInputs } from '@/shared/runtime/field-inputs';

const props = defineProps<{ knownKeys: string[] }>();

const model = defineModel<RowData>({ required: true });

const newKey = ref('');
const inputs = useFieldInputs();

const extraKeys = computed(() => Object.keys(model.value).filter((k) => !isInternalJsonFieldKey(k) && !props.knownKeys.includes(k)));

function updateField(key: string, value: JsonValue) {
  model.value = { ...model.value, [key]: value };
}

function removeField(key: string) {
  inputs?.cancel(key);
  const updated = { ...model.value };
  delete updated[key];
  model.value = updated;
}

function addField() {
  const key = newKey.value.trim();
  if (!key) return;
  model.value = { ...model.value, [key]: '' };
  newKey.value = '';
}
</script>
