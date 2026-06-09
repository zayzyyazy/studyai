/** Resolve study topics from server lecture_structure (v5), with markdown fallback. */

function mergeSectionSubtopics(sections, overlay) {
  return sections.map((sec) => {
    const hit = overlay.find(
      (o) => o.label === sec.label || String(o.label).toLowerCase() === String(sec.label).toLowerCase()
    );
    if (hit?.subtopics?.length) return { ...sec, subtopics: hit.subtopics };
    return sec;
  });
}

function parseOverviewSectionsFromMarkdown(overview, de) {
  if (!overview?.trim()) return [];
  const markers = de
    ? [/##\s*Unterthemen/i, /##\s*Unterthemen und Navigation/i]
    : [/##\s*Subtopics/i, /##\s*Subtopics\s*&\s*Navigation/i];
  let section = '';
  for (const re of markers) {
    const m = overview.match(re);
    if (m) {
      const start = m.index;
      const rest = overview.slice(start);
      const nextH2 = rest.slice(m[0].length).search(/\n##\s+/);
      section = nextH2 >= 0 ? rest.slice(0, m[0].length + nextH2) : rest;
      break;
    }
  }
  if (!section) return [];

  const trees = [];
  let current = null;
  for (const line of section.split('\n')) {
    const arrow = line.match(/^\s*[-*]?\s*\*\*(.+?)\*\*\s*[-–—:]>\s*(.+)$/i)
      || line.match(/^\s*[-*]?\s*(.+?)\s*[-–—:]>\s*(.+)$/);
    const subBullet = line.match(/^\s{2,}[-*]\s+(.+)$/);
    const bold = line.match(/^\s*[-*]?\s*\*\*(.+?)\*\*/);
    if (arrow) {
      const parent = arrow[1].replace(/\*\*/g, '').trim();
      const child = arrow[2].trim();
      if (!current || current.label !== parent) {
        current = { label: parent, subtopics: [] };
        trees.push(current);
      }
      if (child.length >= 3) current.subtopics.push({ label: child, role: de ? 'Unterthema' : 'Subtopic', parent, why: '' });
      continue;
    }
    if (bold && !subBullet) {
      current = { label: bold[1].trim(), subtopics: [] };
      trees.push(current);
    } else if (subBullet && current) {
      const sub = subBullet[1].replace(/\*\*/g, '').trim();
      if (sub.length >= 3) {
        current.subtopics.push({ label: sub, role: de ? 'Unterthema' : 'Subtopic', parent: current.label, why: '' });
      }
    }
  }
  return trees.filter((t) => t.label).slice(0, 6);
}

export function getDeepDiveTopicSections(lecture) {
  if (!lecture) return [];

  const structure = lecture?.lectureStructure;
  const de = isGermanLecture(lecture);

  if (structure?.deepDiveSections?.length) {
    const hasSubs = structure.deepDiveSections.some((s) => (s.subtopics || []).length > 0);
    if (hasSubs) return structure.deepDiveSections;
    const fromOverview = parseOverviewSectionsFromMarkdown(lecture?.overview, de);
    if (fromOverview.length) {
      return mergeSectionSubtopics(structure.deepDiveSections, fromOverview);
    }
    return structure.deepDiveSections;
  }

  const fromOverviewOnly = parseOverviewSectionsFromMarkdown(lecture?.overview, de);
  if (fromOverviewOnly.length && !(structure?.deepDiveSections?.length)) {
    return fromOverviewOnly;
  }

  if (structure?.topicTree?.length) {
    const mapped = structure.topicTree.map((theme) => ({
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
    const withSubs = mapped.some((s) => (s.subtopics || []).length > 0);
    if (!withSubs && fromOverviewOnly.length) return mergeSectionSubtopics(mapped, fromOverviewOnly);
    return mapped;
  }

  const navigable = structure?.navigableTopics;
  if (Array.isArray(navigable) && navigable.length) {
    const byParent = new Map();
    const roots = [];
    for (const t of navigable) {
      if (t.parent) {
        if (!byParent.has(t.parent)) byParent.set(t.parent, []);
        byParent.get(t.parent).push(t);
      } else {
        roots.push(t);
      }
    }
    const rootList = roots.length ? roots : navigable.filter((t) => !t.parent);
    return rootList.map((r) => ({
      label: r.label,
      role: r.role || '',
      parent: '',
      why: r.why || '',
      subtopics: (byParent.get(r.label) || []).map((s) => ({
        label: s.label,
        role: s.role || '',
        parent: r.label,
        why: s.why || '',
      })),
    }));
  }

  return extractLegacyTopicCandidates(lecture).map((label) => ({
    label,
    role: '',
    parent: '',
    why: '',
    subtopics: [],
  }));
}

export function getDeepDiveTopics(lecture) {
  if (!lecture) return [];

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
      previousPath: tc.previousLecture?.path || lecture?.courseSequence?.previousPath || null,
      previousId: tc.previousLecture?.id || lecture?.courseSequence?.previousId || null,
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

export function getStudyPath(lecture) {
  return lecture?.lectureStructure?.studyPath || null;
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
