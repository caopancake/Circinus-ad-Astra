import ts from 'typescript';
import { parse } from 'vue/compiler-sfc';

/** @typedef {{ importedName: string | null, localName: string | null, specifier: string, typeOnly: boolean, kind: 'import' | 'export' | 'dynamic' | 'type', line: number, column: number }} ImportSpecifierInfo */
/** @typedef {{ exportedName: string, localName: string, specifier: string | null, importedName: string, typeOnly: boolean }} ExportBinding */
/** @typedef {{ imports: ImportSpecifierInfo[], exports: ExportBinding[], exportedFunctions: string[], dependencyFailures: string[] }} FrontendSource */

/** @param {import('./files.mjs').SourceFile} file @returns {FrontendSource} */
export function parseFrontendSource(file) {
  /** @type {FrontendSource} */
  const facts = { imports: [], exports: [], exportedFunctions: [], dependencyFailures: [] };
  if (!/\.(?:ts|tsx|js|jsx|mjs|vue)$/.test(file.rel)) return facts;
  const blocks = scriptBlocks(file);
  for (const block of blocks) {
    const ast = ts.createSourceFile(file.rel, block.text, ts.ScriptTarget.Latest, true, block.kind);
    /** @param {ts.Node} node @returns {void} */
    function visit(node) {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text;
        const clause = node.importClause;
        if (!clause) addImport(node, specifier, null, null, false, 'import');
        else {
          if (clause.name) addImport(node, specifier, 'default', clause.name.text, clause.isTypeOnly, 'import');
          const bindings = clause.namedBindings;
          if (bindings && ts.isNamespaceImport(bindings)) addImport(node, specifier, '*', bindings.name.text, clause.isTypeOnly, 'import');
          if (bindings && ts.isNamedImports(bindings)) {
            for (const binding of bindings.elements)
              addImport(
                binding,
                specifier,
                binding.propertyName?.text ?? binding.name.text,
                binding.name.text,
                clause.isTypeOnly || binding.isTypeOnly,
                'import',
              );
          }
          if (!clause.name && bindings && ts.isNamedImports(bindings) && bindings.elements.length === 0)
            addImport(node, specifier, null, null, clause.isTypeOnly, 'import');
        }
      } else if (ts.isExportDeclaration(node)) {
        const specifier = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null;
        const clause = node.exportClause;
        if (!clause && specifier) {
          addImport(node, specifier, '*', null, node.isTypeOnly, 'export');
          facts.exports.push({ exportedName: '*', localName: '*', specifier, importedName: '*', typeOnly: node.isTypeOnly });
        } else if (clause && ts.isNamedExports(clause)) {
          for (const binding of clause.elements) {
            const importedName = binding.propertyName?.text ?? binding.name.text;
            const typeOnly = node.isTypeOnly || binding.isTypeOnly;
            if (specifier) addImport(binding, specifier, importedName, null, typeOnly, 'export');
            facts.exports.push({ exportedName: binding.name.text, localName: importedName, specifier, importedName, typeOnly });
          }
        } else if (clause && ts.isNamespaceExport(clause) && specifier) {
          addImport(node, specifier, '*', null, node.isTypeOnly, 'export');
          facts.exports.push({ exportedName: clause.name.text, localName: '*', specifier, importedName: '*', typeOnly: node.isTypeOnly });
        }
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
        addImport(node, node.argument.literal.text, node.qualifier?.getText(ast) ?? '*', null, true, 'type');
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const argument = node.arguments[0];
        if (argument && ts.isStringLiteralLike(argument)) addImport(node, argument.text, '*', null, false, 'dynamic');
        else {
          const prefix = file.text.slice(0, block.offset + node.getStart(ast)).split('\n');
          facts.dependencyFailures.push(
            `${file.rel}:${prefix.length}:${prefix[prefix.length - 1].length + 1}: dynamic dependencies must declare a literal module specifier for capability authorization`,
          );
        }
      }
      if (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
        const isDefault = ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
        if (
          ts.isFunctionDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isTypeAliasDeclaration(node) ||
          ts.isEnumDeclaration(node)
        ) {
          const name = isDefault ? 'default' : node.name?.text;
          if (name) {
            facts.exports.push({
              exportedName: name,
              localName: node.name?.text ?? name,
              specifier: null,
              importedName: name,
              typeOnly: ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node),
            });
            if (ts.isFunctionDeclaration(node)) facts.exportedFunctions.push(name);
          }
        } else if (ts.isVariableStatement(node)) {
          for (const declaration of node.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name)) continue;
            const name = declaration.name.text;
            const localName = declaration.initializer && ts.isIdentifier(declaration.initializer) ? declaration.initializer.text : name;
            facts.exports.push({ exportedName: name, localName, specifier: null, importedName: name, typeOnly: false });
            if (
              declaration.initializer &&
              (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))
            )
              facts.exportedFunctions.push(name);
          }
        }
      }
      if (ts.isExportAssignment(node))
        facts.exports.push({
          exportedName: 'default',
          localName: ts.isIdentifier(node.expression) ? node.expression.text : 'default',
          specifier: null,
          importedName: 'default',
          typeOnly: false,
        });
      ts.forEachChild(node, visit);
    }
    /** @param {ts.Node} node @param {string} specifier @param {string | null} importedName @param {string | null} localName @param {boolean} typeOnly @param {ImportSpecifierInfo['kind']} kind */
    function addImport(node, specifier, importedName, localName, typeOnly, kind) {
      const position = block.offset + node.getStart(ast);
      const prefix = file.text.slice(0, position).split('\n');
      facts.imports.push({
        importedName,
        localName,
        specifier,
        typeOnly,
        kind,
        line: prefix.length,
        column: prefix[prefix.length - 1].length + 1,
      });
    }
    visit(ast);
  }
  return facts;
}

/** @param {import('./files.mjs').SourceFile} file @returns {{text: string, offset: number, kind: ts.ScriptKind}[]} */
function scriptBlocks(file) {
  if (!file.rel.endsWith('.vue')) return [{ text: file.text, offset: 0, kind: scriptKind(file.rel.split('.').at(-1)) }];
  const { descriptor, errors } = parse(file.text, { filename: file.rel });
  if (errors.length)
    throw new Error(`${file.rel}: ${errors.map((error) => (typeof error === 'string' ? error : error.message)).join('; ')}`);
  return [descriptor.script, descriptor.scriptSetup].flatMap((block) =>
    block ? [{ text: block.content, offset: block.loc.start.offset, kind: scriptKind(block.lang ?? 'js') }] : [],
  );
}

/** @param {string | undefined} language @returns {ts.ScriptKind} */
function scriptKind(language) {
  if (language === 'tsx') return ts.ScriptKind.TSX;
  if (language === 'jsx') return ts.ScriptKind.JSX;
  return language === 'ts' ? ts.ScriptKind.TS : ts.ScriptKind.JS;
}
