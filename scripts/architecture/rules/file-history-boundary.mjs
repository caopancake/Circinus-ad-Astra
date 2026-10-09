import { classifyFrontendPath } from '../../shared/classify.mjs';
import { frontendFile, specFile } from '../../shared/files.mjs';

export const fileHistoryBoundaryRule = {
  name: 'file-history-boundary',
  /** @param {import('../../shared/files.mjs').RepoFile[]} files @returns {string[]} */
  check(files) {
    const failures = [];
    for (const file of files) {
      if (!frontendFile(file.rel)) continue;
      // Spec fixtures seed the real file-history store directly; the ownership
      // boundary governs production call sites only.
      if (specFile(file.rel)) continue;
      const current = classifyFrontendPath(file.rel);
      const isFileHistoryWrite = current.layer === 'orchestrators' && current.domain === 'file-history-write';
      const isFileHistoryReplay = current.layer === 'orchestrators' && current.domain === 'file-history-replay';
      const isFileHistoryStore = current.layer === 'stores' && current.domain === 'file-history';
      const isTableSave = current.layer === 'orchestrators' && current.domain === 'table-save';

      if (/\bFileChangeRecord\s*\[\]\s*=\s*\[\]/.test(file.text)) {
        failures.push(`${file.rel}: file history changesets must come from write results, not ad hoc empty arrays`);
      }

      if (/\bpushSavedWriteEntry\s*\(/.test(file.text) && !isFileHistoryWrite && !isFileHistoryStore) {
        failures.push(`${file.rel}: saved write completion must enter file history through File History Write`);
      }

      if (/\bcommitReplay(?:Undo|Redo)\s*\(/.test(file.text) && !isFileHistoryReplay && !isFileHistoryStore) {
        failures.push(`${file.rel}: file history replay commits must be owned by File History Replay`);
      }

      if (/(?<!function\s)\breplayFileChangeSet\s*\(/.test(file.text) && !isFileHistoryReplay) {
        failures.push(`${file.rel}: file history changeset replay must be owned by File History Replay`);
      }

      if (/\bemitWindowEvent\s*\(\s*WINDOW_EVENTS\.fileEditorTextApplied/.test(file.text) && !isFileHistoryReplay) {
        failures.push(`${file.rel}: file editor replay sync must be emitted by File History Replay`);
      }

      if (isTableSave) {
        const recordIndex = file.text.indexOf('completeSavedWrite');
        const baselineIndexes = [
          file.text.indexOf('applySavedRowKeyMapForMod'),
          file.text.indexOf('markTableSavedForMod'),
          file.text.indexOf('clearCsvEditHistory'),
        ].filter((index) => index >= 0);
        if (recordIndex >= 0 && baselineIndexes.some((index) => index < recordIndex)) {
          failures.push(`${file.rel}: CSV baseline and draft history can only commit after saved write completion`);
        }
      }
    }
    return failures;
  },
};
