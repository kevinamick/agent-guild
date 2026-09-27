// Post-it colours for board items, used on the 3D corkboards and in the board
// window. Colour means something where the item says what it is (work item type,
// labels, PR state); anything else gets a steady colour from its number.

export const POSTIT = {
  yellow: '#fff27a',
  pink: '#ffb3d9',
  blue: '#a7d8ff',
  green: '#b9f2a1',
  orange: '#ffc988',
  purple: '#d9c2ff',
};

const MIX = [POSTIT.yellow, POSTIT.blue, POSTIT.green, POSTIT.orange, POSTIT.purple, POSTIT.pink];

const ADO_TYPES = [
  [/bug|defect|impediment/i, POSTIT.pink],
  [/user story|product backlog item|requirement|story/i, POSTIT.blue],
  [/feature/i, POSTIT.purple],
  [/epic/i, POSTIT.orange],
  [/task/i, POSTIT.yellow],
];

const LABELS = [
  [/bug|defect|regression|crash/i, POSTIT.pink],
  [/enhancement|feature|story/i, POSTIT.blue],
  [/doc/i, POSTIT.green],
  [/question|discussion|help/i, POSTIT.purple],
  [/chore|refactor|tech.?debt|maintenance/i, POSTIT.orange],
];

export function noteColor(item, kind) {
  if (kind === 'prs') {
    if (item.isDraft) return POSTIT.purple;
    if (item.reviewDecision === 'APPROVED') return POSTIT.green;
    if (item.reviewDecision === 'CHANGES_REQUESTED') return POSTIT.orange;
  } else {
    // An ADO work item says its type; a GitHub issue has labels.
    const byType = item.type && ADO_TYPES.find(([re]) => re.test(item.type));
    if (byType) return byType[1];
    for (const label of item.labels || []) {
      const byLabel = LABELS.find(([re]) => re.test(label.name || ''));
      if (byLabel) return byLabel[1];
    }
  }
  return MIX[Math.abs(Number(item.number) || 0) % MIX.length];
}
