export const CSS_TOKEN_OWNER = 'src/styles/base.css';

export const THIRD_PARTY_PROPERTIES = new Map([
  [
    '.n-base-selection',
    [
      '--n-border',
      '--n-border-hover',
      '--n-border-active',
      '--n-border-focus',
      '--n-box-shadow-active',
      '--n-box-shadow-focus',
      '--n-color',
      '--n-color-active',
      '--n-color-disabled',
      '--n-placeholder-color',
      '--n-text-color',
      '--n-arrow-color',
      '--n-border-radius',
    ],
  ],
  ['.n-base-selection-tags .n-tag', ['--n-color', '--n-border', '--n-text-color', '--n-border-radius']],
  [
    '.n-base-select-menu',
    [
      '--n-color',
      '--n-border-radius',
      '--n-box-shadow',
      '--n-option-height',
      '--n-option-font-size',
      '--n-option-text-color',
      '--n-option-text-color-active',
      '--n-option-text-color-disabled',
      '--n-option-color-pending',
      '--n-option-color-active',
      '--n-option-color-active-pending',
    ],
  ],
  ['.tool-switch', ['--n-rail-color', '--n-rail-color-active', '--n-button-color', '--n-button-box-shadow', '--n-box-shadow-focus']],
]);
export const DOM_PROPERTIES = new Map([
  ['--preview-color', ['.color-picker-preview::after']],
  ['--hue-color', ['.color-picker-sv']],
]);
export const SPECIAL_VALUES = [
  ['src/styles/base.css', '.schema-select-option-thumb', 'border-radius', '2px'],
  ['src/styles/base.css', '.color-picker-sv-handle', 'border-radius', '50%'],
  ['src/styles/base.css', '.color-picker-sv-handle', 'box-shadow', '0 0 0 1px rgba(0,0,0,0.72)'],
  ['src/styles/base.css', '::-webkit-scrollbar-thumb', 'border-radius', '999px'],
  ['src/styles/workspace.css', '.mod-tab-status', 'border-radius', '50%'],
  ['src/styles/workspace.css', '.mod-tab-dirty', 'border-radius', '50%'],
  ['src/styles/config.css', '.config-entity-list-item.active', 'box-shadow', 'inset 2px 0 0 var(--color-primary)'],
  ['src/styles/settings.css', '.accent-swatch-button.active', 'box-shadow', 'inset 0 0 0 1px var(--color-primary)'],
  ['src/styles/settings.css', '.accent-custom-control.active', 'box-shadow', 'inset 0 0 0 1px var(--color-primary)'],
  ['src/styles/tables.css', '.data-table th', 'box-shadow', 'inset 0-1px 0 var(--color-border-strong)'],
  ['src/styles/tables.css', '.data-table tr.selected td', 'box-shadow', 'inset 0-1px 0 var(--color-primary-border)'],
  ['src/styles/tables.css', '.data-table td.dirty', 'box-shadow', 'inset 0 0 0 1px var(--color-warning-border)'],
  ['src/styles/tables.css', '.data-table td.csv-cell-active', 'box-shadow', 'inset 0 0 0 1px var(--color-primary-border)'],
  ['src/styles/tables.css', '.csv-cell-frame-active', 'box-shadow', '0 0 0 1px var(--color-primary-soft)'],
  ['src/styles/overview.css', '.overview-mod-card.card-active', 'box-shadow', 'inset 0 0 0 1px var(--color-primary-border)'],
  ...[
    '.mod-tab-close:focus-visible',
    '.mod-tab-activate:focus-visible',
    '.mod-tabs-overview:focus-visible',
    '.mod-navigation-button:focus-visible',
  ].map((selector) => ['src/styles/workspace.css', selector, 'box-shadow', 'inset 0 0 0 1px var(--color-primary-border)']),
];
