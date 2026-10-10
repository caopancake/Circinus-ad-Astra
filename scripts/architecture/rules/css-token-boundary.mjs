import * as csstree from 'css-tree';

const REQUIRED_TOKENS = [
  '--color-bg',
  '--color-overlay',
  '--color-panel',
  '--color-panel-muted',
  '--color-surface',
  '--color-surface-hover',
  '--color-surface-active',
  '--color-border',
  '--color-border-strong',
  '--color-text',
  '--color-text-soft',
  '--color-muted',
  '--color-faint',
  '--color-primary',
  '--color-primary-hover',
  '--color-primary-pressed',
  '--color-primary-soft',
  '--color-primary-border',
  '--color-on-primary',
  '--color-warning',
  '--color-warning-bg',
  '--color-warning-border',
  '--color-danger',
  '--color-success',
  '--color-success-bg',
  '--color-danger-bg',
  '--color-danger-text',
  '--color-danger-border-soft',
  '--color-danger-highlight-soft',
  '--color-danger-highlight',
  '--color-danger-highlight-border',
  '--color-canvas-bg',
  '--scrollbar-thumb',
  '--scrollbar-thumb-hover',
  '--scrollbar-track',
  '--space-1',
  '--space-2',
  '--space-3',
  '--space-4',
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--shadow-floating',
  '--shadow-subtle',
];
const DARK_REQUIRED_TOKENS = REQUIRED_TOKENS.filter((token) => !token.startsWith('--space-') && !token.startsWith('--radius-'));
const CSS_VAR_PATTERN = /var\(\s*(--[\w-]+)/g;
const SHARED_SPACING_PATTERN = /(?:^|\s)(?:4|8|12|16)px(?:$|\s)/;

export const cssTokenBoundaryRule = {
  name: 'css-token-boundary',
  /** @param {Array<{rel: string, text: string}>} files @returns {string[]} */
  check(files) {
    const styles = files.filter((file) => file.rel.startsWith('src/styles/') && file.rel.endsWith('.css'));
    const failures = [];
    const definitions = new Set();
    const baseDefinitions = new Set();
    const darkDefinitions = new Set();
    /** @type {Array<{file: {rel: string}, node: any, value: string}>} */
    const declarations = [];

    for (const file of styles) {
      let ast;
      try {
        ast = csstree.parse(file.text, { positions: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${file.rel}: CSS parse failed: ${message}`);
        continue;
      }
      csstree.walk(ast, {
        visit: 'Declaration',
        /** @param {any} node */
        enter(node) {
          const value = csstree.generate(node.value);
          declarations.push({ file, node, value });
          if (node.property.startsWith('--')) definitions.add(node.property);
        },
      });
      csstree.walk(ast, {
        visit: 'Rule',
        /** @param {any} rule */
        enter(rule) {
          const selector = csstree.generate(rule.prelude);
          if (selector === ':root' || selector === ':root[data-theme="light"]' || selector === ":root[data-theme='light']")
            collectRuleDefinitions(rule.block, baseDefinitions);
          if (selector === ':root[data-theme="dark"]' || selector === ":root[data-theme='dark']")
            collectRuleDefinitions(rule.block, darkDefinitions);
        },
      });
    }

    for (const token of REQUIRED_TOKENS) {
      if (!baseDefinitions.has(token)) failures.push(`src/styles/base.css: missing base token ${token}`);
    }
    for (const token of DARK_REQUIRED_TOKENS) {
      if (!darkDefinitions.has(token)) failures.push(`src/styles/base.css: missing dark theme token ${token}`);
    }
    for (const { file, node, value } of declarations) {
      for (const match of value.matchAll(CSS_VAR_PATTERN)) {
        const referenced = match[1];
        if (!referenced.startsWith('--n-') && !definitions.has(referenced) && !['--hue-color', '--preview-color'].includes(referenced)) {
          const location = node.loc?.start;
          failures.push(`${file.rel}:${location?.line ?? 1}:${location?.column ?? 1}: undefined CSS variable ${referenced}`);
        }
      }
    }
    for (const { file, node, value } of declarations) {
      if (node.property === 'box-shadow' && !isApprovedShadow(value))
        failures.push(diagnostic(file, node, 'box-shadow must use a shared shadow token'));
      if (node.property === 'border-radius' && !isApprovedRadius(value))
        failures.push(diagnostic(file, node, 'border-radius must use a shared radius token'));
      if (isSpacingProperty(node.property) && SHARED_SPACING_PATTERN.test(value) && !value.includes('var(--space-'))
        failures.push(diagnostic(file, node, 'shared spacing must use a --space token'));
    }
    return failures;
  },
};

/** @param {any} block @param {Set<string>} output */
function collectRuleDefinitions(block, output) {
  csstree.walk(block, {
    visit: 'Declaration',
    /** @param {any} node */
    enter(node) {
      if (node.property.startsWith('--')) output.add(node.property);
    },
  });
}

/** @param {{rel: string}} file @param {any} node @param {string} message */
function diagnostic(file, node, message) {
  return `${file.rel}:${node.loc?.start.line ?? 1}:${node.loc?.start.column ?? 1}: ${message}`;
}

/** @param {string} value */
function isApprovedShadow(value) {
  return value === 'none' || value.includes('var(--shadow-') || value.includes('var(--color-') || /^0 0 0 1px /.test(value);
}

/** @param {string} value */
function isApprovedRadius(value) {
  return (
    value === '0' ||
    value === '2px' ||
    value === '50%' ||
    value === '999px' ||
    value.includes('var(--radius-') ||
    value.startsWith('calc(var(--radius-')
  );
}

/** @param {string} property */
function isSpacingProperty(property) {
  return (
    property === 'gap' ||
    property === 'row-gap' ||
    property === 'column-gap' ||
    property === 'padding' ||
    property.startsWith('padding-') ||
    property === 'margin' ||
    property.startsWith('margin-')
  );
}
