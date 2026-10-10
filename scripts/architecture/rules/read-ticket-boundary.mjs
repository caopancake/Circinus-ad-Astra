import { frontendFile, specFile } from '../../shared/files.mjs';

export const readTicketBoundaryRule = {
  name: 'read-ticket-boundary',
  /** @param {import('../../shared/files.mjs').RepoFile[]} files @returns {string[]} */
  check(files) {
    const failures = [];
    for (const file of files) {
      if (!frontendFile(file.rel) || specFile(file.rel)) continue;
      if (file.text.includes('createQueryReadOwner')) {
        failures.push(`${file.rel}: readers must use the formal ReadTicket owner`);
      }
      if (/\breads\.read\s*\(/.test(file.text)) {
        failures.push(`${file.rel}: reader results must be accepted through the ReadTicket owner`);
      }
    }
    return failures;
  },
};
