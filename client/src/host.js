import { useGame } from './net.js';

// Wording for the repo's host. Azure DevOps says "work items" and writes PRs as !7.
export function useHost() {
  const provider = useGame((s) => s.office.provider);
  const ado = provider === 'ado';
  return {
    ado,
    issuesLabel: ado ? 'Work items' : 'Issues',
    issueNoun: ado ? 'work item' : 'issue',
    prRef: (n) => (ado ? `!${n}` : `#${n}`),
  };
}
