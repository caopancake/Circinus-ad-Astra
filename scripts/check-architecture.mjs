import { collectArchitectureFiles } from './shared/files.mjs';
import { rules } from './architecture/rules/index.mjs';

const files = await collectArchitectureFiles(process.cwd());
const failures = files.flatMap((file) => file.dependencyFailures);

for (const rule of rules) {
  failures.push(...rule.check(files));
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
}

if (failures.length === 0) console.log('Architecture check passed.');
