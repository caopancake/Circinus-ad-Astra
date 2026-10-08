import { frontendFile } from '../../shared/files.mjs';
import { classifyFrontendPath } from '../../shared/classify.mjs';

export const schemaModuleBoundaryRule = {
  name: 'schema-module-boundary',
  /** @param {import('../../shared/files.mjs').RepoFile[]} files @returns {string[]} */
  check(files) {
    const failures = [];
    for (const file of files) {
      if (!frontendFile(file.rel)) continue;
      const current = classifyFrontendPath(file.rel);
      if (isSchemaFieldRenderer(file.text, current) && !/\bsettings\.isPlainEditMode\b|\bplainMode\b/.test(file.text)) {
        failures.push(`${file.rel}: schema field rendering must cover plain text and enhanced edit modes`);
      }
      if (current.layer === 'shared' && current.domain === 'types' && /\bSchemaRuntimeContext\b/.test(file.text)) {
        failures.push(`${file.rel}: SchemaRuntimeContext belongs to schema runtime domain, not shared wire types`);
      }
      if (isSchemaFieldRenderer(file.text, current)) {
        for (const token of [
          'querySourceOptions',
          'subscribeSourceOptionInvalidation',
          'sourceOptionsRequestId',
          'pickFileDialog',
          'pathBelongsToRoot',
          'relativePathFromRoot',
        ]) {
          if (new RegExp(`\\b${token}\\b`).test(file.text)) {
            failures.push(`${file.rel}: schema field renderer must delegate ${token} to schema runtime composables`);
          }
        }
      }
      if (isSchemaAssetRegistry(file.text, current)) {
        for (const name of exportedNames(file.text)) {
          if (name !== 'getSchema' && name !== 'getCsvColumnSchemas') {
            failures.push(
              `${file.rel}: schema registry must only export registry entries getSchema and getCsvColumnSchemas, found ${name}`,
            );
          }
        }
      }
      if (isSchemaComponent(current) && /\bresolveSource\s*\(/.test(file.text)) {
        failures.push(`${file.rel}: schema sources must use session source query, not local source resolution`);
      }
      if (/schemas\/.*\.schema\.json/.test(file.text) && /const\s+\w+Schema\s*=/.test(file.text)) {
        failures.push(`${file.rel}: schema definitions must live in schema file assets`);
      }
    }
    return failures;
  },
};

/** @param {import('../../shared/classify.mjs').FrontendPathClass} current @returns {boolean} */
function isSchemaComponent(current) {
  return current.layer === 'app' && current.role === 'component' && current.domain === 'schema';
}

/** @param {string} text @param {import('../../shared/classify.mjs').FrontendPathClass} current @returns {boolean} */
function isSchemaFieldRenderer(text, current) {
  return isSchemaComponent(current) && /\bfield\s*:\s*FieldSchema\b/.test(text);
}

/** @param {string} text @param {import('../../shared/classify.mjs').FrontendPathClass} current @returns {boolean} */
function isSchemaAssetRegistry(text, current) {
  return current.layer === 'domain' && current.domain === 'schema' && /schemas\/.*\.schema\.json/.test(text) && /\bgetSchema\b/.test(text);
}

/** @param {string} text @returns {string[]} */
function exportedNames(text) {
  const names = [];
  const pattern = /\bexport\s+(?:function|const|class|interface|type)\s+([A-Za-z_$][\w$]*)/g;
  /** @type {RegExpExecArray | null} */
  let match;
  while ((match = pattern.exec(text)) !== null) names.push(match[1]);
  return names;
}
