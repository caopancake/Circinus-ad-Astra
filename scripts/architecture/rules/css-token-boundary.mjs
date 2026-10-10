import * as csstree from 'css-tree';
import { CSS_TOKEN_OWNER, THIRD_PARTY_PROPERTIES, DOM_PROPERTIES, SPECIAL_VALUES } from '../../shared/css-policy.mjs';

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

export const cssTokenBoundaryRule = {
  name: 'css-token-boundary',
  /** @param {Array<{rel: string, text: string}>} files @returns {string[]} */
  check(files) {
    const failures = [];
    const global = new Set();
    const base = new Set();
    const dark = new Set();
    /** @type {Map<string, string[]>} */
    const local = new Map();
    /** @type {Array<{ file: { rel: string }, node: import('css-tree').Declaration, value: string, selectors: string[] }>} */
    const declarations = [];
    for (const file of files.filter((file) => file.rel.startsWith('src/styles/') && file.rel.endsWith('.css'))) {
      let ast;
      try {
        ast = csstree.parse(file.text, { positions: true, parseCustomProperty: true });
      } catch (error) {
        failures.push(`${file.rel}: CSS parse failed: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      csstree.walk(ast, {
        visit: 'Rule',
        enter(rule) {
          if (rule.prelude.type !== 'SelectorList') return;
          const selectors = rule.prelude.children.toArray().map((selector) => csstree.generate(selector));
          for (const node of rule.block.children) {
            if (node.type !== 'Declaration') continue;
            const value = csstree.generate(node.value);
            declarations.push({ file, node, value, selectors });
            if (!node.property.startsWith('--')) continue;
            if (node.property.startsWith('--n-')) {
              if (!thirdPartyAllowed(file, selectors, node.property))
                failures.push(diagnostic(file, node, selectors, `unauthorized third-party CSS property ${node.property}`));
              continue;
            }
            const roots = selectors.filter(
              (selector) => selector === ':root' || selector === ':root[data-theme="light"]' || selector === ':root[data-theme="dark"]',
            );
            if (roots.length) {
              if (file.rel !== CSS_TOKEN_OWNER)
                failures.push(diagnostic(file, node, selectors, 'shared CSS tokens must be defined in base.css'));
              global.add(node.property);
              if (roots.some((selector) => selector !== ':root[data-theme="dark"]')) base.add(node.property);
              if (roots.includes(':root[data-theme="dark"]')) dark.add(node.property);
            } else {
              const scopes = local.get(node.property) ?? [];
              scopes.push(...selectors);
              local.set(node.property, scopes);
            }
          }
        },
      });
    }
    for (const token of REQUIRED_TOKENS) if (!base.has(token)) failures.push(`src/styles/base.css: missing base token ${token}`);
    for (const token of new Set([
      ...DARK_REQUIRED_TOKENS,
      ...[...global].filter((token) => token.startsWith('--color-') || token.startsWith('--shadow-')),
    ]))
      if (!dark.has(token)) failures.push(`src/styles/base.css: missing dark theme token ${token}`);

    for (const { file, node, value, selectors } of declarations) {
      /** @type {string[]} */
      const vars = [];
      csstree.walk(node.value, {
        visit: 'Function',
        enter(fn) {
          if (fn.name === 'var' && fn.children.first?.type === 'Identifier') vars.push(fn.children.first.name);
        },
      });
      for (const property of vars) {
        if (property.startsWith('--n-')) {
          if (!thirdPartyAllowed(file, selectors, property))
            failures.push(diagnostic(file, node, selectors, `unauthorized third-party CSS variable ${property}`));
        } else if (!global.has(property)) {
          const scopes = local.get(property) ?? [];
          const injected = file.rel === CSS_TOKEN_OWNER && selectors.every((selector) => DOM_PROPERTIES.get(property)?.includes(selector));
          if (!injected && !selectors.every((selector) => scopes.some((scope) => withinScope(selector, scope)))) {
            const message = scopes.length ? `CSS variable outside its scope ${property}` : `undefined CSS variable ${property}`;
            failures.push(diagnostic(file, node, selectors, message));
          }
        }
      }
      const special = selectors.every((current) =>
        SPECIAL_VALUES.some(
          ([path, selector, property, expected]) =>
            file.rel === path && current === selector && node.property === property && value === expected,
        ),
      );
      if (special) continue;
      if (node.property === 'box-shadow' && value !== 'none' && !onlyTokenValue(node.value, '--shadow-', ['none']))
        failures.push(diagnostic(file, node, selectors, 'box-shadow must use a shared shadow token'));
      if (node.property === 'border-radius' && value !== '0' && !onlyTokenValue(node.value, '--radius-', ['0']))
        failures.push(diagnostic(file, node, selectors, 'border-radius must use a shared radius token'));
      if (isSpacingProperty(node.property)) {
        let hardcoded = false;
        csstree.walk(node.value, {
          visit: 'Dimension',
          enter(dimension) {
            if (dimension.unit === 'px' && [4, 8, 12, 16].includes(Number(dimension.value))) hardcoded = true;
          },
        });
        if (hardcoded) failures.push(diagnostic(file, node, selectors, 'shared spacing must use a --space token'));
      }
    }
    return failures;
  },
};

/** @param {string} selector @param {string} scope */
function withinScope(selector, scope) {
  return selector === scope || selector.startsWith(`${scope} `) || selector.startsWith(`${scope}>`) || selector.startsWith(`${scope}:`);
}

/** @param {{rel: string}} file @param {string[]} selectors @param {string} property */
function thirdPartyAllowed(file, selectors, property) {
  return file.rel === CSS_TOKEN_OWNER && selectors.every((selector) => THIRD_PARTY_PROPERTIES.get(selector)?.includes(property));
}

/** @param {import('css-tree').CssNode} value @param {string} prefix @param {string[]} literals */
function onlyTokenValue(value, prefix, literals) {
  if (value.type !== 'Value') return false;
  const nodes = value.children.toArray();
  return (
    nodes.length > 0 &&
    nodes.every(
      (node) =>
        literals.includes(csstree.generate(node)) ||
        (node.type === 'Function' &&
          node.name === 'var' &&
          node.children.first?.type === 'Identifier' &&
          node.children.first.name.startsWith(prefix)) ||
        (node.type === 'Function' &&
          node.name === 'calc' &&
          node.children
            .toArray()
            .some(
              (child) =>
                child.type === 'Function' &&
                child.name === 'var' &&
                child.children.first?.type === 'Identifier' &&
                child.children.first.name.startsWith(prefix),
            )),
    )
  );
}

/** @param {{rel: string}} file @param {import('css-tree').CssNode} node @param {string[]} selectors @param {string} message */
function diagnostic(file, node, selectors, message) {
  return `${file.rel}:${node.loc?.start.line ?? 1}:${node.loc?.start.column ?? 1}: ${message} [${selectors.join(', ')}; ${node.type === 'Declaration' ? node.property : ''}]`;
}

/** @param {string} property */
function isSpacingProperty(property) {
  return (
    ['gap', 'row-gap', 'column-gap', 'padding', 'margin'].includes(property) ||
    property.startsWith('padding-') ||
    property.startsWith('margin-')
  );
}
