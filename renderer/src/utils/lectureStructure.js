/** Resolve study topics from server lecture_structure (v5), with markdown fallback. */

export function getDeepDiveTopicSections(lecture) {
  const structure = lecture?.lectureStructure;
  const de = isGermanLecture(lecture);

  if (structure?.deepDiveSections?.length) {
    return structure.deepDiveSections;
  }

  if (structure?.topicTree?.length) {
    return structure.topicTree.map((theme) => ({
      label: theme.label,
      role: theme.role || (de ? 'Kernthema' : 'Core theme'),
      parent: '',
      why: '',
      subtopics: (theme.subtopics || []).map((sub) => ({
        label: sub,
        role: de ? 'Unterthema' : 'Subtopic',
        parent: theme.label,
        why: '',
      })),
    }));
  }

  const flat = getDeepDiveTopics(lecture);
  const byParent = new Map();
  const roots = [];

  for (const t of flat) {
    if (t.parent) {
      if (!byParent.has(t.parent)) byParent.set(t.parent, []);
      byParent.get(t.parent).push(t);
    } else {
      roots.push(t);
    }
  }

  if (roots.length) {
    return roots.map((r) => ({
      label: r.label,
      role: r.role,
      parent: '',
      why: r.why,
      subtopics: (byParent.get(r.label) || []).map((s) => ({
        label: s.label,
        role: s.role,
        parent: r.label,
        why: s.why,
      })),
    }));
  }

  return flat.map((t) => ({
    label: t.label,
    role: t.role,
    parent: '',
    why: t.why,
    subtopics: [],
  }));
}

export function getDeepDiveTopics(lecture) {
  const sections = getDeepDiveTopicSections(lecture);
  const flat = [];
  for (const section of sections) {
    flat.push({
      label: section.label,
      role: section.role || '',
      why: section.why || '',
      parent: '',
      recurrence: null,
    });
    for (const sub of section.subtopics || []) {
      flat.push({
        label: sub.label,
        role: sub.role || '',
        why: sub.why || '',
        parent: sub.parent || section.label,
        recurrence: null,
      });
    }
  }
  if (flat.length) return flat;

  return extractLegacyTopicCandidates(lecture).map((label) => ({
    label,
    role: '',
    why: '',
    parent: '',
    recurrence: null,
  }));
}

export function getCourseSequence(lecture) {
  if (lecture?.courseSequence) return lecture.courseSequence;
  if (lecture?.lectureStructure?.courseSequence) return lecture.lectureStructure.courseSequence;
  const tc = lecture?.threadContext;
  if (tc?.sequenceLabel) {
    return {
      label: tc.sequenceLabel,
      index: tc.sequenceIndex,
      total: tc.sequenceTotal,
      buildsOn: tc.buildsOn,
      previousName: tc.previousLecture?.name || null,
    };
  }
  return null;
}

export function getFocusTheme(lecture) {
  return lecture?.lectureStructure?.focusTheme || lecture?.meta?.focusTheme || '';
}

export function getCoreThemes(lecture) {
  const fromStructure = lecture?.lectureStructure?.coreThemes;
  if (Array.isArray(fromStructure) && fromStructure.length) return fromStructure;
  return lecture?.meta?.coreThemes || [];
}

export function getTopicTree(lecture) {
  return lecture?.lectureStructure?.topicTree || [];
}

export function getPrerequisites(lecture) {
  const fromStructure = lecture?.lectureStructure?.prerequisites;
  if (Array.isArray(fromStructure) && fromStructure.length) return fromStructure;
  return lecture?.meta?.prerequisites || [];
}

export function getRecurringThemes(lecture) {
  return lecture?.lectureStructure?.recurringThemes || [];
}

export function getThreadContext(lecture) {
  return lecture?.threadContext || lecture?.meta?.threadContext || null;
}

export function isGermanLecture(lecture) {
  const lang = lecture?.lectureStructure?.language || lecture?.meta?.outputLanguage || '';
  return /german|deutsch/i.test(lang);
}

function extractLegacyTopicCandidates(lecture) {
  const source = `${lecture?.concepts || ''}\n${lecture?.overview || ''}`;
  const lines = source.split('\n').map((l) => l.trim()).filter(Boolean);
  const headingTopics = lines
    .filter((l) => l.startsWith('## '))
    .map((l) => l.replace(/^##\s+/, '').replace(/\*+/g, '').trim())
    .filter((l) => l.length > 3 && l.length < 80);
  const boldTerms = [];
  for (const line of lines) {
    const matches = [...line.matchAll(/\*\*(.+?)\*\*/g)];
    for (const m of matches) {
      const term = (m[1] || '').trim();
      if (term.length > 3 && term.length < 70) boldTerms.push(term);
      if (boldTerms.length >= 12) break;
    }
    if (boldTerms.length >= 12) break;
  }
  const unique = [];
  for (const item of [...headingTopics, ...boldTerms]) {
    if (!unique.some((u) => u.toLowerCase() === item.toLowerCase())) unique.push(item);
  }
  return unique.slice(0, 8);
}

export function slugifyTopic(label) {
  return String(label || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
