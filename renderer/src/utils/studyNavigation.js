/** Map planner block types to CoursePage tabs. */
export function blockTypeToTab(blockType) {
  if (blockType === 'deep_dive') return 'deepDive';
  if (blockType === 'quiz') return 'quiz';
  if (blockType === 'concepts') return 'concepts';
  if (blockType === 'summary') return 'summary';
  if (blockType === 'notes') return 'notes';
  if (blockType === 'aufgaben' || blockType === 'exercises' || blockType === 'practice_sheet') return 'aufgaben';
  if (blockType === 'deep_dive' || blockType === 'explain') return 'deepDive';
  return 'overview';
}

export function plannerActionToTab(action) {
  if (!action) return 'overview';
  return blockTypeToTab(String(action).toLowerCase().replace(/-/g, '_'));
}
