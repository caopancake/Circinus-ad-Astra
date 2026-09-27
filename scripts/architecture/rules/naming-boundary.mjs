import { frontendFile, specFile } from '../../shared/files.mjs';
import { exportedFunctionNames } from '../../shared/imports.mjs';

export const namingBoundaryRule = {
  name: 'naming-boundary',
  /** @param {import('../../shared/files.mjs').RepoFile[]} files @returns {string[]} */
  check(files) {
    const failures = [];
    for (const file of files) {
      if (!frontendFile(file.rel)) continue;
      // Directory-suffix conventions govern production modules; colocated
      // specs keep the .spec.ts suffix instead.
      const isSpec = specFile(file.rel);
      if (!isSpec && file.rel.startsWith('src/services/') && !file.rel.endsWith('.service.ts')) {
        failures.push(`${file.rel}: service files must use .service.ts`);
      }
      if (!isSpec && file.rel.startsWith('src/stores/') && !file.rel.endsWith('.store.ts')) {
        failures.push(`${file.rel}: store files must use .store.ts`);
      }
      for (const match of file.text.matchAll(/\bdefineStore\(\s*'([A-Za-z0-9-]+)'/g)) {
        if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(match[1])) {
          failures.push(`${file.rel}: Pinia store id "${match[1]}" must use kebab-case`);
        }
      }
      if (!isSpec && file.rel.startsWith('src/orchestrators/') && !file.rel.endsWith('.orchestrator.ts')) {
        failures.push(`${file.rel}: orchestrator files must use .orchestrator.ts`);
      }
      if (!isSpec && file.rel.startsWith('src/windows/') && !file.rel.endsWith('.window.ts') && !file.rel.endsWith('.events.ts')) {
        failures.push(`${file.rel}: window files must use .window.ts or .events.ts`);
      }
      if (file.rel.includes('/composables/use-') && !file.rel.endsWith('.ts')) {
        failures.push(`${file.rel}: ViewModel/composable files must be TypeScript modules`);
      }
      if (file.rel.startsWith('src/app/components/config/') && file.rel.endsWith('.vue') && !/\/Config[A-Za-z0-9]+\.vue$/.test(file.rel)) {
        failures.push(`${file.rel}: config components must use Config* names`);
      }
      if (file.rel.startsWith('src/domain/') && /\.(service|store|orchestrator)\.ts$/.test(file.rel)) {
        failures.push(`${file.rel}: domain files must not use responsibility suffixes`);
      }
      if (/\bimport\s+(?:type\s+)?\{[^{}]*\bas\b[^{}]*\}\s+from\b/.test(file.text)) {
        failures.push(`${file.rel}: import aliasing is forbidden`);
      }
      if (file.rel.endsWith('.vue')) {
        for (const match of file.text.matchAll(/\bdefineEmits<\{([\s\S]*?)\}>\s*\(/g)) {
          for (const key of match[1].matchAll(/(?:^|[,{\s])([A-Za-z][A-Za-z0-9]*)\s*:/g)) {
            if (/[A-Z]/.test(key[1])) {
              failures.push(`${file.rel}: emits event "${key[1]}" must use kebab-case`);
            }
          }
        }
        for (const call of file.text.matchAll(/\b(?:emit|\$emit)\(\s*'([A-Za-z0-9-]+)'/g)) {
          if (/[A-Z]/.test(call[1])) {
            failures.push(`${file.rel}: emitted event "${call[1]}" must use kebab-case`);
          }
        }
      }
      for (const name of exportedFunctionNames(file.text)) {
        if (/^(?:save|create|delete|upload)(?!FileEditor|TextFile|ModFiles)[A-Za-z0-9_]*File$/.test(name)) {
          failures.push(`${file.rel}: business action ${name} must not use File to describe a save effect`);
        }
      }
    }
    return failures;
  },
};
