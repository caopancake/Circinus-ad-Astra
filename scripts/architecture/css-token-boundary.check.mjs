import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cssTokenBoundaryRule } from './rules/css-token-boundary.mjs';

const base = `:root {
  --color-bg: #fff;
  --color-overlay: #fff;
  --color-panel: #fff;
  --color-panel-muted: #fff;
  --color-surface: #fff;
  --color-surface-hover: #fff;
  --color-surface-active: #fff;
  --color-border: #fff;
  --color-border-strong: #fff;
  --color-text: #fff;
  --color-text-soft: #fff;
  --color-muted: #fff;
  --color-faint: #fff;
  --color-primary: #fff;
  --color-primary-hover: #fff;
  --color-primary-pressed: #fff;
  --color-primary-soft: #fff;
  --color-primary-border: #fff;
  --color-on-primary: #fff;
  --color-warning: #fff;
  --color-warning-bg: #fff;
  --color-warning-border: #fff;
  --color-danger: #fff;
  --color-success: #fff;
  --color-success-bg: #fff;
  --color-danger-bg: #fff;
  --color-danger-text: #fff;
  --color-danger-border-soft: #fff;
  --color-danger-highlight-soft: #fff;
  --color-danger-highlight: #fff;
  --color-danger-highlight-border: #fff;
  --color-canvas-bg: #fff;
  --scrollbar-thumb: #fff;
  --scrollbar-thumb-hover: #fff;
  --scrollbar-track: transparent;
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --radius-sm: 4px; --radius-md: 8px; --radius-lg: 12px;
  --shadow-floating: none; --shadow-subtle: none;
}
:root[data-theme='dark'] {
  --color-bg: #000; --color-panel: #000; --color-panel-muted: #000; --color-surface: #000;
  --color-overlay: #000;
  --color-surface-hover: #000; --color-surface-active: #000; --color-border: #000; --color-border-strong: #000;
  --color-text: #000; --color-text-soft: #000; --color-muted: #000; --color-faint: #000; --color-primary: #000;
  --color-primary-hover: #000; --color-primary-pressed: #000; --color-primary-soft: #000; --color-primary-border: #000;
  --color-on-primary: #000; --color-warning: #000; --color-warning-bg: #000; --color-warning-border: #000;
  --color-danger: #000; --color-success: #000; --color-success-bg: #000; --color-danger-bg: #000; --color-danger-text: #000;
  --color-danger-border-soft: #000; --color-danger-highlight-soft: #000; --color-danger-highlight: #000;
  --color-danger-highlight-border: #000; --color-canvas-bg: #000; --scrollbar-thumb: #000; --scrollbar-thumb-hover: #000; --scrollbar-track: transparent;
  --shadow-floating: none; --shadow-subtle: none;
}
.panel { border-radius: var(--radius-md); box-shadow: var(--shadow-subtle); color: var(--missing); }
`;

test('CSS tokens and shared radius/shadow semantics pass', () => {
  const failures = cssTokenBoundaryRule.check([{ rel: 'src/styles/base.css', text: base }]);
  assert.deepEqual(failures, ['src/styles/base.css:53:77: undefined CSS variable --missing']);
});

test('CSS checker reports hardcoded shared radius and shadow values', () => {
  const failures = cssTokenBoundaryRule.check([
    { rel: 'src/styles/base.css', text: `${base}.bad { border-radius: 6px; box-shadow: 0 1px 2px #000; }` },
  ]);
  assert.equal(failures.filter((failure) => failure.includes('shared radius')).length, 1);
  assert.equal(failures.filter((failure) => failure.includes('shared shadow')).length, 1);
});

test('CSS checker reports hardcoded shared spacing values', () => {
  const failures = cssTokenBoundaryRule.check([{ rel: 'src/styles/base.css', text: `${base}.bad { gap: 8px; padding: 4px 6px; }` }]);
  assert.equal(failures.filter((failure) => failure.includes('shared spacing')).length, 2);
});
