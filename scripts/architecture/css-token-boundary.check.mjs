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
  assert.deepEqual(failures, ['src/styles/base.css:53:77: undefined CSS variable --missing [.panel; color]']);
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

test('local variables follow their selector scope across descendants', () => {
  const failures = cssTokenBoundaryRule.check([
    {
      rel: 'src/styles/base.css',
      text: `${base}
    .owner { --local: 6px; padding: var(--local); }
    .owner .child { padding: var(--local); }
    .other { padding: var(--local); }
  `,
    },
  ]);
  assert.equal(failures.filter((failure) => failure.includes('outside its scope --local')).length, 1);
  assert.ok(failures.some((failure) => failure.includes('[.other; padding]')));
});

test('third-party and DOM-injected variables have explicit file, selector and property authorization', () => {
  const failures = cssTokenBoundaryRule.check([
    {
      rel: 'src/styles/base.css',
      text: `${base}
    .n-base-selection { --n-color: var(--color-panel); }
    .other { --n-color: red; color: var(--n-color); background: var(--hue-color); }
    .color-picker-sv { background: var(--hue-color); }
  `,
    },
  ]);
  assert.equal(failures.filter((failure) => failure.includes('third-party')).length, 2);
  assert.equal(failures.filter((failure) => failure.includes('undefined CSS variable --hue-color')).length, 1);
});

test('mixed declarations and color-based shadows retain their shared-token checks', () => {
  const failures = cssTokenBoundaryRule.check([
    {
      rel: 'src/styles/base.css',
      text: `${base}
    .other { padding: var(--space-1) 8px; box-shadow: 0 3px 12px var(--color-border); border-radius: var(--radius-sm) 2px; }
  `,
    },
  ]);
  for (const message of ['shared spacing', 'shared shadow', 'shared radius'])
    assert.equal(failures.filter((failure) => failure.includes(message)).length, 1);
});

test('special visual semantics are authorized by exact selector and property', () => {
  const failures = cssTokenBoundaryRule.check([
    {
      rel: 'src/styles/base.css',
      text: `${base}
    .color-picker-sv-handle { border-radius: 50%; box-shadow: 0 0 0 1px rgba(0,0,0,0.72); }
    .other { border-radius: 50%; box-shadow: 0 0 0 1px rgba(0,0,0,0.72); }
  `,
    },
  ]);
  assert.equal(failures.filter((failure) => failure.includes('shared radius')).length, 1);
  assert.equal(failures.filter((failure) => failure.includes('shared shadow')).length, 1);
});
