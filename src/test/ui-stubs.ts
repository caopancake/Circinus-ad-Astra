import type { Component } from 'vue';

export type GlobalStubs = Record<string, Component>;

/// Minimal Naive UI stand-ins for component tests: elements keep the same
/// update:* events so specs can drive them through native inputs.
export const nInput = {
  methods: {
    focus(this: { $el: HTMLElement }) {
      this.$el.focus();
    },
  },
  props: ['value', 'type', 'placeholder', 'disabled', 'size', 'status', 'autosize'],
  emits: ['update:value', 'change', 'blur'],
  template: `<textarea
    v-if="type === 'textarea'"
    :value="value ?? ''"
    :disabled="disabled"
    @input="$emit('update:value', $event.target.value)"
    @change="$emit('change', $event.target.value)"
    @blur="$emit('blur', $event)"
  />
  <input
    v-else
    :value="value ?? ''"
    :disabled="disabled"
    @input="$emit('update:value', $event.target.value)"
    @change="$emit('change', $event.target.value)"
    @blur="$emit('blur', $event)"
  />`,
};

export const nInputNumber = {
  props: ['value', 'disabled', 'min', 'max', 'size', 'step', 'showButton'],
  emits: ['update:value'],
  template: `<input
    type="number"
    :value="value ?? ''"
    :disabled="disabled"
    @input="$emit('update:value', $event.target.value === '' ? null : Number($event.target.value))"
  />`,
};

export const nSwitch = {
  props: ['value', 'size', 'disabled'],
  emits: ['update:value'],
  template: `<button type="button" class="n-switch-stub" :disabled="disabled" @click="$emit('update:value', !value)" />`,
};

export const nSelect = {
  props: ['value', 'options', 'filterable', 'tag', 'clearable', 'disabled', 'size', 'show'],
  emits: ['update:value', 'update:show'],
  template: `<select
    class="n-select-stub"
    :value="JSON.stringify(value ?? null)"
    :disabled="disabled"
    @change="$emit('update:value', JSON.parse($event.target.value))"
  >
    <option
      v-for="option in options || []"
      :key="JSON.stringify(option.value)"
      :value="JSON.stringify(option.value)"
    >{{ option.label }}</option>
  </select>`,
};

export const nButton = {
  props: ['type', 'size', 'disabled', 'ghost', 'tertiary', 'quaternary', 'secondary', 'loading', 'title'],
  emits: ['click'],
  template: `<button type="button" :disabled="disabled || loading" @click="$emit('click', $event)"><slot /></button>`,
};

export const nCheckbox = {
  props: ['checked'],
  emits: ['update:checked'],
  template: `<input type="checkbox" :checked="checked" @change="$emit('update:checked', $event.target.checked)" />`,
};

export const nDynamicTags = {
  props: ['value'],
  emits: ['update:value'],
  template: `<span class="n-dynamic-tags-stub">
    <span v-for="tag in value || []" :key="tag" class="n-dynamic-tag" @click="$emit('update:value', (value || []).filter((item) => item !== tag))">{{ tag }}</span>
  </span>`,
};

export const nPopover = {
  props: ['show', 'placement', 'showArrow', 'raw', 'trigger'],
  emits: ['update:show', 'clickoutside'],
  template: `<div class="n-popover-stub"><slot name="trigger" /><div v-if="show"><slot /></div></div>`,
};

export const nCollapse = {
  props: ['expandedNames', 'themeOverrides'],
  emits: ['update:expandedNames'],
  template: `<div class="n-collapse-stub"><slot /></div>`,
};

export const nCollapseItem = {
  props: ['title', 'name'],
  template: `<div class="n-collapse-item-stub" :data-name="name"><div class="n-collapse-item-title">{{ title }}</div><slot /></div>`,
};

/// One bundle covering every Naive UI component used by the editor and table
/// components under test.
export const editorUiStubs: GlobalStubs = {
  'n-input': nInput,
  'n-input-number': nInputNumber,
  'n-switch': nSwitch,
  'n-select': nSelect,
  'n-button': nButton,
  'n-checkbox': nCheckbox,
  'n-dynamic-tags': nDynamicTags,
  'n-popover': nPopover,
  'n-collapse': nCollapse,
  'n-collapse-item': nCollapseItem,
};
