const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Store = require('electron-store');

let pdfProcessingActive = false;
let courseRowsCache = { key: '', rows: [] };

function courseRowsCacheKey(courseName) {
  const vaultPath = store.get('vaultPath') || '';
  return `${vaultPath}::${sanitizeName(courseName || '')}`;
}

function invalidateCourseRowsCache() {
  courseRowsCache = { key: '', rows: [] };
}

function getEnrichedCourseRows(courseName) {
  const key = courseRowsCacheKey(courseName);
  if (!key.endsWith('::') && courseRowsCache.key === key) return courseRowsCache.rows;
  const raw = getCourseLectureRowsRaw(courseName);
  const rows = enrichCourseLectureRows(courseName, raw);
  courseRowsCache = { key, rows };
  return rows;
}

const store = new Store({
  schema: {
    apiKey: { type: 'string', default: '' },
    aiProvider: { type: 'string', default: 'openai' },
    generationModel: { type: 'string', default: 'gpt-4o' },
    outputLanguagePreference: { type: 'string', default: 'auto' },
    generationMode: { type: 'string', default: 'balanced' },
    vaultPath: { type: 'string', default: '' },
    pluginSettings: {
      type: 'object',
      default: {
        pdfIntake: true,
        courseAwareGeneration: true,
        mathStatsSupport: true,
        localExporters: true,
        studyPlanner: true
      }
    },
    schedulerDefaults: {
      type: 'object',
      default: {
        weeklyReviewDay: 'Sunday',
        revisitAfterDays: 7,
        targetHoursPerEcts: 0.75
      }
    },
    plannerSettings: {
      type: 'object',
      default: {
        weeklyCapacityHours: 14,
        plannerStyle: 'realistic',
        preferredLightStart: true,
        reviewDay: 'Friday',
        dailyStudyDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
        protectedLightDays: [],
        coursePriorityOverrides: {}
      }
    },
    weeklyPlan: { type: ['object', 'null'], default: null },
    plannerMessages: { type: 'array', default: [] },
    courses: {
      type: 'array',
      default: [],
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          emoji: { type: 'string' },
          color: { type: 'string' },
          credits: { type: 'number' },
          moduleGroup: { type: 'string' },
          semester: { type: 'string' },
          priority: { type: 'number' },
          weeklyHours: { type: 'number' },
          inFocus: { type: 'boolean' },
          language: { type: 'string' },
          courseType: { type: 'string' }
        }
      }
    },
    onboardingComplete: { type: 'boolean', default: false }
  }
});

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'StudyAI',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/dist/index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ─── IPC: Store operations ───────────────────────────────────────────────────

ipcMain.handle('store:get', (_, key) => store.get(key));
ipcMain.handle('store:set', (_, key, value) => { store.set(key, value); return true; });
ipcMain.handle('store:getAll', () => store.store);

// ─── IPC: Dialog ─────────────────────────────────────────────────────────────

ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose Vault Location'
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('dialog:openPdf', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'PDF files', extensions: ['pdf'] }],
    title: 'Choose Lecture PDF'
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('dialog:openPdfs', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PDF files', extensions: ['pdf'] }],
    title: 'Choose Lecture PDFs'
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths.map((p) => ({
      path: p,
      name: path.basename(p)
    }));
  }
  return [];
});

// ─── IPC: Shell ───────────────────────────────────────────────────────────────

ipcMain.handle('shell:openPath', (_, p) => shell.openPath(p));

// ─── IPC: Vault / File operations ────────────────────────────────────────────

ipcMain.handle('vault:checkPath', (_, vaultPath) => {
  try {
    return fs.existsSync(vaultPath) && fs.statSync(vaultPath).isDirectory();
  } catch {
    return false;
  }
});

function getCourseMetaByName(courseName = '') {
  const courses = store.get('courses') || [];
  return courses.find((c) => c.name === courseName) || {};
}

/** Parse Overview "Unterthemen / Subtopics" section into theme → subtopic list. */
function parseOverviewSubtopicTree(overview = '', language = 'German') {
  const isGerman = language === 'German';
  const markers = isGerman
    ? [/##\s*Unterthemen/i, /##\s*Unterthemen und Navigation/i, /##\s*Kernthemen/i]
    : [/##\s*Subtopics/i, /##\s*Subtopics\s*&\s*Navigation/i, /##\s*Core Themes/i];
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

  const lines = section.split('\n');
  const trees = [];
  let current = null;

  for (const line of lines) {
    const bold = line.match(/^\s*[-*]?\s*\*\*(.+?)\*\*/);
    const arrow = line.match(/^\s*[-*]?\s*\*\*(.+?)\*\*\s*[-–—:]>\s*(.+)$/i)
      || line.match(/^\s*[-*]?\s*(.+?)\s*[-–—:]>\s*(.+)$/);
    const subBullet = line.match(/^\s{2,}[-*]\s+(.+)$/) || line.match(/^\s+[-*]\s+(.+)$/);
    const topBullet = line.match(/^\s*[-*]\s+(.+)$/);

    if (arrow) {
      const parent = arrow[1].replace(/\*\*/g, '').trim();
      const child = arrow[2].trim();
      if (!current || !topicLooseMatch(current.label, parent)) {
        current = { label: parent, subtopics: [] };
        trees.push(current);
      }
      if (child.length >= 3) current.subtopics.push(child);
      continue;
    }

    if (bold && !subBullet) {
      const label = bold[1].trim();
      if (label.length >= 3) {
        current = { label, subtopics: [] };
        trees.push(current);
      }
      continue;
    }

    if (subBullet && current) {
      const sub = subBullet[1].replace(/\*\*/g, '').trim();
      if (sub.length >= 3 && !topicLooseMatch(sub, current.label)) current.subtopics.push(sub);
    } else if (topBullet) {
      const raw = topBullet[1].replace(/\*\*/g, '').trim();
      const childMatch = raw.match(/^(.+?)\s*[-–—:]>\s*(.+)$/);
      if (childMatch) {
        const parent = childMatch[1].trim();
        const child = childMatch[2].trim();
        if (!current || !topicLooseMatch(current.label, parent)) {
          current = { label: parent, subtopics: [] };
          trees.push(current);
        }
        if (child.length >= 3) current.subtopics.push(child);
      } else if (raw.length >= 3) {
        current = { label: raw.split(/\s*[-–—:]\s/)[0].trim(), subtopics: [] };
        trees.push(current);
      }
    }
  }

  return trees
    .map((t) => ({
      label: polishDeepDiveLabel(t.label, language),
      subtopics: [...new Set(t.subtopics.map((s) => polishDeepDiveLabel(s, language)).filter((s) => s && s.length >= 3))].slice(0, 6)
    }))
    .filter((t) => t.label && t.label.length >= 3)
    .slice(0, 6);
}

function extractProgrammingSubtopics(extracted = '') {
  const subs = new Set();
  const text = String(extracted || '').slice(0, 120000);
  for (const m of text.matchAll(/\b(def|class)\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
    subs.add(`${m[1]} ${m[2]}`);
  }
  for (const m of text.matchAll(/\b(import|from)\s+([A-Za-z_][A-Za-z0-9_.]*)/g)) {
    if (m[2] && !m[2].startsWith('.')) subs.add(`import ${m[2].split('.')[0]}`);
  }
  for (const m of text.matchAll(/```(\w+)?/g)) {
    if (m[1] && m[1].length <= 12) subs.add(m[1]);
  }
  return [...subs].slice(0, 8);
}

function mergeTopicTrees(baseTree = [], overlayTree = []) {
  const out = [...baseTree];
  for (const ov of overlayTree) {
    const hit = out.find((t) => topicLooseMatch(t.label, ov.label));
    if (hit) {
      const merged = new Set([...(hit.subtopics || []), ...(ov.subtopics || [])]);
      hit.subtopics = [...merged].slice(0, 6);
    } else {
      out.push({
        id: slugify(ov.label) || `theme-${out.length + 1}`,
        label: ov.label,
        role: '',
        subtopics: (ov.subtopics || []).slice(0, 6)
      });
    }
  }
  return out.slice(0, 6);
}

function enrichStructureFromOverview(structure, overview = '', language = 'German') {
  if (!overview?.trim()) return structure;
  const parsed = parseOverviewSubtopicTree(overview, language);
  if (!parsed.length) return structure;

  const isGerman = language === 'German';
  let topicTree = mergeTopicTrees(structure.topicTree || [], parsed.map((t, i) => ({
    id: slugify(`${i + 1}-${t.label}`),
    label: t.label,
    role: i === 0 ? (isGerman ? 'Kernthema' : 'Core theme') : (isGerman ? 'Kernthema' : 'Core theme'),
    subtopics: t.subtopics
  })));

  const deepDiveSections = buildDeepDiveSections({
    focusTheme: structure.focusTheme || parsed[0]?.label,
    topicTree,
    recurringThemes: structure.recurringThemes || [],
    prerequisites: structure.prerequisites || [],
    language
  });

  return {
    ...structure,
    topicTree,
    deepDiveSections,
    deepDiveTopics: flattenDeepDiveSections(deepDiveSections)
  };
}

function findDeepDiveTopicContext(structure, topic = '') {
  const label = String(topic || '').trim();
  if (!label || !structure) return { parent: '', isSubtopic: false };
  for (const section of structure.deepDiveSections || []) {
    for (const sub of section.subtopics || []) {
      const subLabel = typeof sub === 'string' ? sub : sub.label;
      if (subLabel === label || topicLooseMatch(subLabel, label)) {
        return { parent: section.label, isSubtopic: true };
      }
    }
    if (section.label === label || topicLooseMatch(section.label, label)) {
      return { parent: '', isSubtopic: false };
    }
  }
  for (const theme of structure.topicTree || []) {
    for (const sub of theme.subtopics || []) {
      const subLabel = typeof sub === 'string' ? sub : sub.label;
      if (subLabel === label || topicLooseMatch(subLabel, label)) {
        return { parent: theme.label, isSubtopic: true };
      }
    }
  }
  return { parent: '', isSubtopic: false };
}

function ensureLectureStructureFields(structure, { courseName, lecturePath, meta = {}, overview = '' }) {
  if (!structure || typeof structure !== 'object') return structure;
  const language = structure.language || meta.outputLanguage || 'German';
  let next = { ...structure, version: Math.max(structure.version || 0, 5), language };
  if (overview) {
    next = enrichStructureFromOverview(next, overview, language);
  }
  if (!next.deepDiveSections?.length && (next.topicTree?.length || next.focusTheme)) {
    next.deepDiveSections = buildDeepDiveSections({
      focusTheme: next.focusTheme,
      topicTree: next.topicTree || [],
      recurringThemes: next.recurringThemes || [],
      prerequisites: next.prerequisites || [],
      language
    });
  }
  if (!next.deepDiveTopics?.length && next.deepDiveSections?.length) {
    next.deepDiveTopics = flattenDeepDiveSections(next.deepDiveSections);
  }
  if (!next.courseSequence) {
    next.courseSequence = buildCourseSequenceEntry(courseName, lecturePath, meta);
  }
  if (!next.studyPath?.units?.length && (next.topicTree?.length || next.focusTheme)) {
    next.studyPath = buildStudyPath(next, language);
  }
  return next;
}

function readLectureListRow({ courseName, courseDir, lectureFolder }) {
  const lecturePath = path.join(courseDir, lectureFolder);
  const metaPath = path.join(lecturePath, 'meta.json');
  const structurePath = path.join(lecturePath, 'lecture_structure.json');
  const deepDiveIndexPath = path.join(lecturePath, 'deep_dives', 'index.json');
  const notesPath = path.join(lecturePath, 'notes.md');
  const studyCardPath = path.join(lecturePath, 'study_card.json');

  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch {}

  let lectureStructure = null;
  try { lectureStructure = JSON.parse(fs.readFileSync(structurePath, 'utf8')); } catch {}
  if (lectureStructure) {
    const before = JSON.stringify(lectureStructure);
    const overview = safeRead(path.join(lecturePath, 'overview.md'));
    lectureStructure = ensureLectureStructureFields(lectureStructure, { courseName, lecturePath, meta, overview });
    if (JSON.stringify(lectureStructure) !== before) {
      try { fs.writeFileSync(structurePath, JSON.stringify(lectureStructure, null, 2), 'utf8'); } catch {}
    }
  }

  let deepDiveIndex = [];
  try { deepDiveIndex = JSON.parse(fs.readFileSync(deepDiveIndexPath, 'utf8')); } catch {}

  let notes = '';
  try { notes = fs.readFileSync(notesPath, 'utf8'); } catch {}

  let hasStudyCard = false;
  try { hasStudyCard = fs.existsSync(studyCardPath) || fs.existsSync(path.join(lecturePath, 'study_card.md')); } catch {}

  const displayName = resolveLectureDisplayName(meta, lectureStructure, lectureFolder, courseName);
  if (displayName && displayName !== meta.inferredLectureName) {
    meta.inferredLectureName = displayName;
    try { fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8'); } catch {}
  }

  const courseSequence = lectureStructure?.courseSequence || buildCourseSequenceEntry(courseName, lecturePath, meta);

  return {
    id: lectureFolder,
    name: displayName,
    path: lecturePath,
    meta,
    notes,
    hasStudyCard,
    lectureStructure,
    courseSequence,
    deepDiveIndex,
    inferredProgress: meta.plannerStatus === 'done' ? 'done' : inferProgress(meta),
    hasSummary: fs.existsSync(path.join(lecturePath, 'summary.md')),
    hasConcepts: fs.existsSync(path.join(lecturePath, 'concepts.md')),
    hasOverview: fs.existsSync(path.join(lecturePath, 'overview.md')),
    hasQuiz: fs.existsSync(path.join(lecturePath, 'quiz.md'))
  };
}

function readLectureDetails(lecturePath, courseName = '') {
  const metaPath = path.join(lecturePath, 'meta.json');
  const summaryPath = path.join(lecturePath, 'summary.md');
  const conceptsPath = path.join(lecturePath, 'concepts.md');
  const overviewPath = path.join(lecturePath, 'overview.md');
  const quizPath = path.join(lecturePath, 'quiz.md');
  const extractedPath = path.join(lecturePath, 'extracted.txt');
  const structurePath = path.join(lecturePath, 'lecture_structure.json');
  const studyCardPath = path.join(lecturePath, 'study_card.json');
  const studyCardMdPath = path.join(lecturePath, 'study_card.md');
  const notesPath = path.join(lecturePath, 'notes.md');

  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch {}

  const summary = safeRead(summaryPath);
  const concepts = safeRead(conceptsPath);
  const overview = safeRead(overviewPath);
  const quiz = safeRead(quizPath);
  const extracted = safeRead(extractedPath);
  const notes = safeRead(notesPath);

  let lectureStructure = safeJson(structurePath);
  const needsRebuild = !lectureStructure
    || lectureStructure.version < 5
    || (!lectureStructure.deepDiveSections?.length && !lectureStructure.deepDiveTopics?.length && !lectureStructure.topicTree?.length);
  if (needsRebuild) {
    lectureStructure = buildLectureStructure({ courseName: courseName || meta.course || '', lecturePath, meta, overview, summary, concepts, extracted });
  } else {
    lectureStructure = ensureLectureStructureFields(lectureStructure, {
      courseName: courseName || meta.course || '',
      lecturePath,
      meta,
      overview
    });
  }
  try { fs.writeFileSync(structurePath, JSON.stringify(lectureStructure, null, 2), 'utf8'); } catch {}

  let studyCard = safeJson(studyCardPath);
  if (!studyCard?.markdown) {
    const md = safeRead(studyCardMdPath);
    if (md.trim()) studyCard = { ...(studyCard || {}), markdown: md };
  }

  let deepDiveIndex = [];
  try { deepDiveIndex = JSON.parse(fs.readFileSync(path.join(lecturePath, 'deep_dives', 'index.json'), 'utf8')); } catch {}

  let aufgaben = safeJson(path.join(lecturePath, 'aufgaben.json'));
  if (!aufgaben?.exercises?.length) {
    const md = safeRead(path.join(lecturePath, 'aufgaben.md'));
    if (md.trim()) aufgaben = { ...(aufgaben || {}), markdownFallback: md };
  }
  let aufgabenProgress = safeJson(path.join(lecturePath, 'aufgaben_progress.json')) || {};

  const lectureFolder = path.basename(lecturePath);
  const displayName = resolveLectureDisplayName(meta, lectureStructure, lectureFolder, courseName || meta.course || '');
  if (displayName && displayName !== meta.inferredLectureName) {
    meta.inferredLectureName = displayName;
    try { fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8'); } catch {}
  }

  const noteCards = loadNoteCards(lecturePath).cards || [];
  const deepStudy = ensureDeepStudy(meta);
  const coverage = computeDeepStudyCoverage(lectureStructure, deepStudy);

  return {
    summary,
    concepts,
    overview,
    quiz,
    notes,
    studyCard,
    noteCards,
    deepStudy,
    deepStudyCoverage: coverage,
    lectureStructure,
    courseSequence: lectureStructure?.courseSequence || buildCourseSequenceEntry(courseName || meta.course || '', lecturePath, meta),
    deepDiveIndex,
    aufgaben,
    aufgabenProgress,
    meta,
    displayName,
    threadContext: buildLectureThreadContext(courseName || meta.course || '', lecturePath)
  };
}

ipcMain.handle('lecture:generateAufgaben', async (_, { lecturePath }) => {
  const apiKey = store.get('apiKey');
  if (!apiKey) return { success: false, error: 'Missing API key' };
  try {
    const summary = safeRead(path.join(lecturePath, 'summary.md'));
    const concepts = safeRead(path.join(lecturePath, 'concepts.md'));
    const overview = safeRead(path.join(lecturePath, 'overview.md'));
    const extracted = safeRead(path.join(lecturePath, 'extracted.txt'));
    const meta = safeJson(path.join(lecturePath, 'meta.json')) || {};
    const { OpenAI } = require('openai');
    const openai = new OpenAI({ apiKey });
    const result = await generateAufgabenBundle({
      openai,
      model: getGenerationModel(),
      lecturePath,
      courseName: meta.course || '',
      meta,
      overview,
      summary,
      concepts,
      extracted
    });
    if (!result.success) return result;
    writeAufgabenFiles(lecturePath, result.aufgaben, result.markdown);
    return { success: true, aufgaben: result.aufgaben };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('lecture:loadAufgaben', (_, { lecturePath }) => {
  try {
    const aufgabenPath = path.join(lecturePath, 'aufgaben.json');
    let aufgaben = safeJson(aufgabenPath);
    const progress = safeJson(path.join(lecturePath, 'aufgaben_progress.json')) || {};
    const markdown = safeRead(path.join(lecturePath, 'aufgaben.md'));
    if (!aufgaben?.exercises?.length && markdown.trim()) {
      return { success: true, aufgaben: null, markdown, progress };
    }
    if (!aufgaben?.exercises?.length) return { success: false, error: 'No exercises yet' };
    return { success: true, aufgaben, markdown, progress };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('lecture:saveAufgabenProgress', (_, { lecturePath, progress = {} }) => {
  try {
    if (!lecturePath) return { success: false, error: 'Missing lecture path' };
    const progressPath = path.join(lecturePath, 'aufgaben_progress.json');
    fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2), 'utf8');
    const metaPath = path.join(lecturePath, 'meta.json');
    const meta = safeJson(metaPath) || {};
    const doneCount = Object.values(progress).filter((s) => s === 'done').length;
    meta.aufgabenProgress = { doneCount, updatedAt: new Date().toISOString() };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
    return { success: true, progress };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('vault:getLectures', (_, courseName) => {
  const vaultPath = store.get('vaultPath');
  if (!vaultPath) return [];
  const courseDir = path.join(vaultPath, sanitizeName(courseName));
  if (!fs.existsSync(courseDir)) return [];

  invalidateCourseRowsCache();
  try {
    getEnrichedCourseRows(courseName);
    const lectures = fs.readdirSync(courseDir)
      .filter((f) => {
        try {
          return fs.statSync(path.join(courseDir, f)).isDirectory();
        } catch {
          return false;
        }
      })
      .map((lectureFolder) => {
        try {
          return readLectureListRow({ courseName, courseDir, lectureFolder });
        } catch (err) {
          console.error('Skipping lecture row:', lectureFolder, err.message);
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => {
        const ai = a.courseSequence?.index ?? a.threadContext?.sequenceIndex ?? 999;
        const bi = b.courseSequence?.index ?? b.threadContext?.sequenceIndex ?? 999;
        if (ai !== bi) return ai - bi;
        const aTime = a.meta?.processedAt ? new Date(a.meta.processedAt).getTime() : 0;
        const bTime = b.meta?.processedAt ? new Date(b.meta.processedAt).getTime() : 0;
        return aTime - bTime;
      });

    invalidateCourseRowsCache();
    return lectures;
  } catch (err) {
    console.error('Error reading lectures:', err);
    invalidateCourseRowsCache();
    return [];
  }
});

ipcMain.handle('vault:getLectureDetails', (_, { lecturePath, courseName }) => {
  try {
    if (!lecturePath) return { success: false, error: 'Missing lecture path' };
    const details = readLectureDetails(lecturePath, courseName || '');
    return { success: true, ...details };
  } catch (err) {
    console.error('getLectureDetails error:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('vault:getCourseOverview', () => {
  const vaultPath = store.get('vaultPath');
  const courses = store.get('courses') || [];
  if (!vaultPath) return [];
  return courses.map((course) => {
    const courseDir = path.join(vaultPath, sanitizeName(course.name));
    const rows = fs.existsSync(courseDir)
      ? fs.readdirSync(courseDir).filter((f) => fs.statSync(path.join(courseDir, f)).isDirectory())
      : [];
    let activeCount = 0;
    let startedCount = 0;
    for (const lectureFolder of rows) {
      const metaPath = path.join(courseDir, lectureFolder, 'meta.json');
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch {}
      const progress = inferProgress(meta);
      if (progress === 'active') activeCount += 1;
      if (progress === 'started' || progress === 'active') startedCount += 1;
    }
    return {
      courseId: course.id,
      lectureCount: rows.length,
      startedCount,
      activeCount,
      recommendedScore: Number(course.priority || 3) * (Number(course.credits) || 3)
    };
  });
});

ipcMain.handle('vault:getDashboard', () => {
  const vaultPath = store.get('vaultPath');
  const courses = store.get('courses') || [];
  const scheduler = store.get('schedulerDefaults') || {};
  const plannerSettings = getPlannerSettings();
  const weeklyPlan = store.get('weeklyPlan') || null;
  if (!vaultPath) return { totalLectures: 0, startedLectures: 0, activeLectures: 0, totalCredits: 0, weeklyHours: 0, weeklyCapacityHours: plannerSettings.weeklyCapacityHours, weeklyPlan, todayBlocks: [], items: [], continueItems: [], suggestions: [], threadHighlights: [], nextAction: null };
  const items = [];
  const continueItems = [];
  let totalLectures = 0;
  let startedLectures = 0;
  let activeLectures = 0;
  let totalCredits = 0;
  let weeklyHours = 0;
  for (const course of courses) {
    const courseDir = path.join(vaultPath, sanitizeName(course.name));
    const lectureFolders = fs.existsSync(courseDir)
      ? fs.readdirSync(courseDir).filter((f) => fs.statSync(path.join(courseDir, f)).isDirectory())
      : [];
    totalCredits += Number(course.credits || 0);
    weeklyHours += Number(course.weeklyHours || 0);
    totalLectures += lectureFolders.length;
    let courseStarted = 0;
    let courseActive = 0;
    for (const folder of lectureFolders) {
      const metaPath = path.join(courseDir, folder, 'meta.json');
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch {}
      const progress = meta.plannerStatus === 'done' ? 'done' : inferProgress(meta);
      const lastActiveAt = meta.activity?.lastActiveAt || meta.processedAt || null;
      if (progress !== 'not_started') {
        startedLectures += 1;
        courseStarted += 1;
        continueItems.push({
          courseId: course.id,
          courseName: course.name,
          lectureId: folder,
          lecturePath: path.join(courseDir, folder),
          lectureName: meta.inferredLectureName || folder.replace(/_/g, ' '),
          topicHints: Array.isArray(meta.topicHints) ? meta.topicHints.slice(0, 4) : [],
          lastActiveAt,
          progress,
          profile: meta.lectureProfile || 'general'
        });
      }
      if (progress === 'active') {
        activeLectures += 1;
        courseActive += 1;
      }
    }
    items.push({
      courseId: course.id,
      courseName: course.name,
      inFocus: Boolean(course.inFocus),
      priority: Number(course.priority || 3),
      weeklyHours: Number(course.weeklyHours || 0),
      credits: Number(course.credits || 0),
      semester: course.semester || 'Unscheduled',
      moduleGroup: course.moduleGroup || 'General',
      lectureCount: lectureFolders.length,
      startedCount: courseStarted,
      activeCount: courseActive,
      behindCount: Math.max(0, lectureFolders.length - courseStarted),
      loadScore: Number(course.priority || 3) * (Number(course.credits) || 0),
      suggestedStudyHours: Math.round((Number(course.credits || 0) * Number(scheduler.targetHoursPerEcts || 0.75)) * 10) / 10
    });
  }
  const sorted = items.sort((a, b) => Number(b.inFocus) - Number(a.inFocus) || (b.priority * b.credits) - (a.priority * a.credits));
  continueItems.sort((a, b) => new Date(b.lastActiveAt || 0) - new Date(a.lastActiveAt || 0));
  const world = collectStudyWorld();
  const openLectures = world.lectures.filter((l) => l.progress !== 'done');
  const nextLecture = openLectures[0] || world.lectures[0] || null;
  const threadHighlights = buildThreadHighlights(world).slice(0, 4);
  const studySuggestions = buildDashboardSuggestions(sorted, world, nextLecture);
  return {
    totalLectures,
    startedLectures,
    activeLectures,
    totalCredits,
    weeklyHours,
    revisitAfterDays: Number(scheduler.revisitAfterDays || 7),
    weeklyCapacityHours: Number(plannerSettings.weeklyCapacityHours || 14),
    weeklyPlan,
    todayBlocks: getTodayBlocks(weeklyPlan),
    items: sorted,
    continueItems: continueItems.slice(0, 4),
    suggestions: studySuggestions,
    threadHighlights,
    nextAction: nextLecture ? {
      courseId: nextLecture.courseId,
      courseName: nextLecture.courseName,
      lectureId: nextLecture.id,
      lecturePath: nextLecture.path,
      lectureName: nextLecture.name,
      focusTheme: nextLecture.focusTheme || nextLecture.topicHints?.[0] || '',
      action: nextLecture.workload.recommendedBlockType,
      reason: nextLecture.workload.reason,
      minutes: nextLecture.workload.remainingMinutes,
      prerequisites: getLecturePrerequisites(nextLecture.path).slice(0, 4),
      thread: buildLectureThreadContext(nextLecture.courseName, nextLecture.path)
    } : null
  };
});

ipcMain.handle('vault:readFile', (_, filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
});
// ─── IPC: Planner ───────────────────────────────────────────────────────────

ipcMain.handle('planner:getState', () => {
  const world = collectStudyWorld();
  let plan = store.get('weeklyPlan') || null;
  if (!plan || plan.worldSignature !== world.signature) {
    plan = buildWeeklyPlan({ world, reason: plan ? 'Study world changed' : 'Initial weekly plan' });
    store.set('weeklyPlan', plan);
  }
  return {
    settings: getPlannerSettings(),
    world,
    plan,
    messages: (store.get('plannerMessages') || []).slice(-30)
  };
});

ipcMain.handle('planner:generateWeeklyPlan', (_, payload = {}) => {
  const world = collectStudyWorld();
  const settings = getPlannerSettings();
  const nextSettings = {
    ...settings,
    ...(payload.weeklyCapacityHours ? { weeklyCapacityHours: Number(payload.weeklyCapacityHours) } : {}),
    ...(payload.plannerStyle ? { plannerStyle: payload.plannerStyle } : {})
  };
  if (payload.weeklyCapacityHours || payload.plannerStyle) store.set('plannerSettings', nextSettings);
  const plan = buildWeeklyPlan({
    world,
    settings: nextSettings,
    reason: payload.reason || 'Manual re-plan',
    constraints: payload.constraints || {}
  });
  store.set('weeklyPlan', plan);
  return { success: true, plan, settings: nextSettings, world };
});

ipcMain.handle('planner:updateBlock', (_, { blockId, status }) => {
  const plan = store.get('weeklyPlan') || null;
  if (!plan?.days) return { success: false, error: 'No weekly plan exists yet' };
  let updatedBlock = null;
  const now = new Date().toISOString();
  const next = {
    ...plan,
    updatedAt: now,
    days: plan.days.map((day) => ({
      ...day,
      blocks: (day.blocks || []).map((block) => {
        if (block.id !== blockId) return block;
        updatedBlock = { ...block, status: status || 'planned', updatedAt: now };
        return updatedBlock;
      })
    }))
  };
  if (!updatedBlock) return { success: false, error: 'Block not found' };
  store.set('weeklyPlan', next);
  if (updatedBlock.lecturePath && status === 'done') {
    markLecturePlannerActivity(updatedBlock.lecturePath, updatedBlock.blockType);
  }
  return { success: true, plan: next, block: updatedBlock };
});

ipcMain.handle('planner:clearPlan', () => {
  store.set('weeklyPlan', null);
  store.set('plannerMessages', []);
  return { success: true };
});

ipcMain.handle('planner:chat', async (_, { message }) => {
  const text = String(message || '').trim();
  if (!text) return { success: false, error: 'Empty message' };
  const now = new Date().toISOString();
  const messages = store.get('plannerMessages') || [];
  const userMessage = { id: `u-${Date.now()}`, role: 'user', text, createdAt: now };
  const parsed = parsePlannerInstruction(text);
  let world = collectStudyWorld();
  let plan = store.get('weeklyPlan') || buildWeeklyPlan({ world, reason: 'Planner chat opened' });
  let settings = getPlannerSettings();
  let changed = false;

  if (parsed.capacityHours) {
    settings = { ...settings, weeklyCapacityHours: parsed.capacityHours };
    store.set('plannerSettings', settings);
    changed = true;
  }
  if (parsed.lighter) {
    settings = { ...settings, plannerStyle: 'lighter' };
    store.set('plannerSettings', settings);
    changed = true;
  }
  if (parsed.ambitious) {
    settings = { ...settings, plannerStyle: 'ambitious' };
    store.set('plannerSettings', settings);
    changed = true;
  }
  if (parsed.doneText) {
    const marked = markLikelyLectureDone(world, parsed.doneText);
    if (marked) {
      world = collectStudyWorld();
      changed = true;
    }
  }
  if (parsed.focusCourseName) {
    const course = findCourseByText(world.courses, parsed.focusCourseName);
    if (course) {
      const overrides = { ...(settings.coursePriorityOverrides || {}), [course.id]: 2 };
      settings = { ...settings, coursePriorityOverrides: overrides };
      store.set('plannerSettings', settings);
      changed = true;
    }
  }

  if (changed || parsed.replan) {
    plan = buildWeeklyPlan({
      world,
      settings,
      reason: 'Planner chat rebalanced the week',
      constraints: {
        lightToday: parsed.lightToday,
        reviewFriday: parsed.reviewFriday,
        missedEarlyWeek: parsed.missedEarlyWeek,
        focusCourseName: parsed.focusCourseName
      }
    });
    store.set('weeklyPlan', plan);
  } else if (!store.get('weeklyPlan')) {
    store.set('weeklyPlan', plan);
  }

  let reply = buildLocalPlannerReply(text, world, plan, settings, parsed, changed);
  const apiKey = store.get('apiKey');
  if (apiKey) {
    try {
      const { OpenAI } = require('openai');
      const openai = new OpenAI({ apiKey });
      const response = await openai.chat.completions.create({
        model: getGenerationModel(),
        messages: [
          { role: 'system', content: buildPlannerSystemPrompt() },
          { role: 'user', content: `Study world JSON:\n${JSON.stringify(compactPlannerContext(world, plan, settings), null, 2)}\n\nStudent message:\n${text}` }
        ],
        temperature: getTemperature(0.25),
        max_tokens: 900
      });
      const aiReply = response.choices?.[0]?.message?.content?.trim();
      if (aiReply) reply = aiReply;
    } catch (err) {
      reply = `${reply}\n\nAI provider note: ${err.message}`;
    }
  }

  const assistantMessage = { id: `a-${Date.now()}`, role: 'assistant', text: reply, createdAt: new Date().toISOString() };
  const nextMessages = [...messages, userMessage, assistantMessage].slice(-40);
  store.set('plannerMessages', nextMessages);
  return { success: true, reply, plan, settings, world, messages: nextMessages };
});


ipcMain.handle('lecture:trackActivity', (_, { lecturePath, eventType, payload }) => {
  try {
    const metaPath = path.join(lecturePath, 'meta.json');
    if (!fs.existsSync(metaPath)) return { success: false, error: 'Meta not found' };
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const activity = meta.activity || {
      openedCount: 0,
      tabViews: {},
      lastOpenedAt: null,
      lastActiveAt: null
    };

    const now = new Date().toISOString();
    if (eventType === 'opened') {
      activity.openedCount += 1;
      activity.lastOpenedAt = now;
    }
    if (eventType === 'tab_view' && payload?.tab) {
      activity.tabViews[payload.tab] = (activity.tabViews[payload.tab] || 0) + 1;
    }
    activity.lastActiveAt = now;

    meta.activity = activity;
    meta.progress = inferProgress(meta);
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
    return { success: true, progress: meta.progress };
  } catch (err) {
    return { success: false, error: err.message };
  }
});


ipcMain.handle('lecture:saveNotes', (_, { lecturePath, notes }) => {
  try {
    if (!lecturePath) return { success: false, error: 'Missing lecture path' };
    fs.writeFileSync(path.join(lecturePath, 'notes.md'), String(notes || ''), 'utf8');
    updateLectureMeta(lecturePath, (meta) => {
      meta.notesUpdatedAt = new Date().toISOString();
      meta.activity = meta.activity || { openedCount: 0, tabViews: {}, lastOpenedAt: null, lastActiveAt: null };
      meta.activity.lastActiveAt = meta.notesUpdatedAt;
      return meta;
    });
    return { success: true, notes: String(notes || '') };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('lecture:listNoteCards', (_, { lecturePath }) => {
  try {
    const data = loadNoteCards(lecturePath);
    return { success: true, cards: data.cards || [] };
  } catch (err) {
    return { success: false, error: err.message, cards: [] };
  }
});

ipcMain.handle('lecture:saveNoteCard', (_, payload) => {
  try {
    const { lecturePath, title, topic, parentTopic, mode, type, markdown, gist, bookmarked } = payload || {};
    if (!lecturePath || !markdown?.trim()) return { success: false, error: 'Missing content' };
    const data = loadNoteCards(lecturePath);
    const card = {
      id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: type || 'deep_dive',
      title: String(title || topic || 'Deep dive').slice(0, 120),
      topic: topic || '',
      parentTopic: parentTopic || '',
      mode: mode || 'explain',
      markdown: String(markdown).trim(),
      gist: String(gist || '').trim().slice(0, 280) || String(markdown).trim().split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '').slice(0, 200) || '',
      bookmarked: bookmarked !== false,
      savedAt: new Date().toISOString()
    };
    data.cards = [card, ...(data.cards || [])].slice(0, 80);
    saveNoteCardsFile(lecturePath, data);
    return { success: true, card, cards: data.cards };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('lecture:deleteNoteCard', (_, { lecturePath, cardId }) => {
  try {
    const data = loadNoteCards(lecturePath);
    data.cards = (data.cards || []).filter((c) => c.id !== cardId);
    saveNoteCardsFile(lecturePath, data);
    return { success: true, cards: data.cards };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('lecture:suggestDeepSteps', async (_, payload) => {
  const apiKey = store.get('apiKey');
  const {
    lecturePath,
    parentTopic = '',
    currentTopic = '',
    currentSubtopic = '',
    deepDiveExcerpt = '',
    subtopicExcerpt = ''
  } = payload || {};
  if (!lecturePath) return { success: false, error: 'Missing lecture path' };

  try {
    const meta = safeJson(path.join(lecturePath, 'meta.json')) || {};
    const summary = safeRead(path.join(lecturePath, 'summary.md'));
    const concepts = safeRead(path.join(lecturePath, 'concepts.md'));
    const overview = safeRead(path.join(lecturePath, 'overview.md'));
    const extracted = safeRead(path.join(lecturePath, 'extracted.txt'));
    const lectureStructure = buildLectureStructure({
      courseName: meta.course || '',
      lecturePath,
      meta,
      overview,
      summary,
      concepts,
      extracted
    });
    const deepStudy = ensureDeepStudy(meta);
    const coverage = computeDeepStudyCoverage(lectureStructure, deepStudy);
    const outputLanguage = readLectureLanguage(lecturePath, `${summary}\n${concepts}`);
    const isGerman = outputLanguage === 'German';

    if (coverage.complete && (deepStudy.explored || []).length >= 2) {
      const msg = isGerman
        ? 'Du hast die Kernthemen dieser Vorlesung gut abgedeckt. Diese Vorlesung ist für heute durch — wiederhole bei Bedarf in Notes oder markiere als erledigt.'
        : 'You have covered the core topics for this lecture well. This lecture is done for now — revisit saved cards in Notes or mark the lecture complete.';
      updateLectureMeta(lecturePath, (m) => {
        const ds = ensureDeepStudy(m);
        ds.complete = true;
        ds.completeAt = new Date().toISOString();
        ds.completeReason = msg;
        ds.lastSuggestions = [];
        m.deepStudy = ds;
        return m;
      });
      const metaAfter = safeJson(path.join(lecturePath, 'meta.json')) || {};
      return {
        success: true,
        complete: true,
        completeMessage: msg,
        suggestions: [],
        coverage,
        deepStudy: ensureDeepStudy(metaAfter)
      };
    }

    if (!apiKey) {
      const fallback = buildHeuristicDeepSuggestions(lectureStructure, deepStudy, {
        parentTopic,
        currentTopic,
        currentSubtopic,
        isGerman
      });
      persistDeepSuggestions(lecturePath, fallback, false, '');
      const metaAfter = safeJson(path.join(lecturePath, 'meta.json')) || {};
      return {
        success: true,
        suggestions: fallback,
        complete: false,
        coverage,
        deepStudy: ensureDeepStudy(metaAfter),
        offline: true
      };
    }

    const { OpenAI } = require('openai');
    const openai = new OpenAI({ apiKey });
    const response = await openai.chat.completions.create({
      model: getGenerationModel(),
      messages: [
        { role: 'system', content: buildDeepStepSuggestionPrompt(outputLanguage, readLectureProfile(lecturePath, extracted)) },
        {
          role: 'user',
          content: JSON.stringify({
            parentTopic,
            currentTopic,
            currentSubtopic,
            coverage,
            explored: (deepStudy.explored || []).slice(-16),
            questions: (deepStudy.askLog || []).slice(-10),
            allTopics: collectNavigableTopicLabels(lectureStructure),
            deepDiveExcerpt: String(deepDiveExcerpt || '').slice(0, 4000),
            subtopicExcerpt: String(subtopicExcerpt || '').slice(0, 4000)
          }, null, 2)
        }
      ],
      temperature: getTemperature(0.35),
      max_tokens: 700
    });
    const parsed = parseJsonObject(response.choices?.[0]?.message?.content || '') || {};
    let suggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions
        .filter((s) => s?.label && String(s.label).trim().length >= 3)
        .slice(0, 5)
        .map((s) => ({
          label: String(s.label).trim(),
          reason: String(s.reason || '').trim().slice(0, 200)
        }))
      : [];

    if (!suggestions.length) {
      suggestions = buildHeuristicDeepSuggestions(lectureStructure, deepStudy, {
        parentTopic,
        currentTopic,
        currentSubtopic,
        isGerman
      });
    }

    const complete = !!parsed.complete || (suggestions.length === 0 && coverage.ratio >= 0.85);
    const completeMessage = complete
      ? String(parsed.completeMessage || (isGerman
        ? 'Diese Vorlesung ist durch — starke Abdeckung. Nutze Notes zum Wiederholen.'
        : 'This lecture is complete — strong coverage. Use Notes to review.'))
      : '';

    persistDeepSuggestions(lecturePath, suggestions, complete, completeMessage);
    const metaAfter = safeJson(path.join(lecturePath, 'meta.json')) || {};

    return {
      success: true,
      suggestions,
      complete,
      completeMessage,
      coverage,
      deepStudy: ensureDeepStudy(metaAfter),
      tokens: response.usage?.total_tokens || 0
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('lecture:loadStudyCard', (_, { lecturePath }) => {
  try {
    if (!lecturePath) return { success: false, error: 'Missing lecture path' };
    const jsonPath = path.join(lecturePath, 'study_card.json');
    const mdPath = path.join(lecturePath, 'study_card.md');
    let card = null;
    try { card = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch {}
    if (!card?.markdown) {
      try {
        const md = fs.readFileSync(mdPath, 'utf8');
        if (md.trim()) card = { ...(card || {}), markdown: md };
      } catch {}
    }
    if (!card) return { success: false, error: 'No study card yet' };
    return { success: true, card };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('lecture:generateStudyCard', async (_, { lecturePath, courseName, lectureTitle }) => {
  const apiKey = store.get('apiKey');
  if (!apiKey) return { success: false, error: 'Missing API key' };
  if (!lecturePath) return { success: false, error: 'Missing lecture path' };

  const notes = safeRead(path.join(lecturePath, 'notes.md'));
  if (!notes.trim()) {
    return { success: false, error: 'Write some notes first — the card is built from your note space.' };
  }

  try {
    const summary = safeRead(path.join(lecturePath, 'summary.md'));
    const concepts = safeRead(path.join(lecturePath, 'concepts.md'));
    const overview = safeRead(path.join(lecturePath, 'overview.md'));
    const extracted = safeRead(path.join(lecturePath, 'extracted.txt'));
    const meta = safeJson(path.join(lecturePath, 'meta.json')) || {};
    const lectureStructure = buildLectureStructure({ lecturePath, meta, overview, summary, concepts, extracted });
    const threadContext = buildLectureThreadContextFromMaterials(lecturePath, { overview, summary, concepts, extracted, lectureStructure });
    const outputLanguage = readLectureLanguage(lecturePath, `${notes}\n${summary}\n${concepts}`);
    const isGerman = outputLanguage === 'German';

    const context = [
      `Course: ${courseName || meta.course || ''}`,
      `Lecture: ${lectureTitle || meta.inferredLectureName || ''}`,
      formatLectureStructureForPrompt(lectureStructure),
      threadContext.markdown,
      `--- ${isGerman ? 'Deine Notizen (Hauptquelle)' : 'Your notes (primary source)'} ---`,
      notes.slice(0, 12000),
      '--- Lecture grounding (secondary) ---',
      overview.slice(0, 6000),
      summary.slice(0, 6000),
      concepts.slice(0, 6000)
    ].join('\n\n');

    const { OpenAI } = require('openai');
    const openai = new OpenAI({ apiKey });
    const schema = `Return strict JSON only:
{
  "title": "short card title",
  "gist": "2-3 sentence personal study gist",
  "keyPoints": ["3-6 bullets from YOUR notes, clarified"],
  "openQuestions": ["what you still need to clear up"],
  "reviewTriggers": ["when to revisit this"],
  "connections": ["links to course threads or prior lectures"],
  "markdown": "full readable card in markdown with ## headings"
}`;
    const response = await openai.chat.completions.create({
      model: getGenerationModel(),
      messages: [
        {
          role: 'system',
          content: `${buildStudyCardPrompt(outputLanguage)}\n${schema}`
        },
        { role: 'user', content: context }
      ],
      temperature: getTemperature(0.28)
    });
    const raw = response.choices?.[0]?.message?.content || '';
    const parsed = parseStudyCardJson(raw);
    if (!parsed?.markdown && !parsed?.gist) {
      return { success: false, error: 'Model returned invalid study card JSON' };
    }

    const card = {
      version: 1,
      language: outputLanguage,
      generatedAt: new Date().toISOString(),
      sourceNotesLength: notes.length,
      title: parsed.title || lectureTitle || meta.inferredLectureName || 'Study card',
      gist: parsed.gist || '',
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
      openQuestions: Array.isArray(parsed.openQuestions) ? parsed.openQuestions : [],
      reviewTriggers: Array.isArray(parsed.reviewTriggers) ? parsed.reviewTriggers : [],
      connections: Array.isArray(parsed.connections) ? parsed.connections : [],
      markdown: parsed.markdown || buildStudyCardMarkdown(parsed, outputLanguage)
    };

    fs.writeFileSync(path.join(lecturePath, 'study_card.json'), JSON.stringify(card, null, 2), 'utf8');
    fs.writeFileSync(path.join(lecturePath, 'study_card.md'), card.markdown, 'utf8');
    updateLectureMeta(lecturePath, (m) => {
      m.studyCardUpdatedAt = card.generatedAt;
      return m;
    });

    return { success: true, card };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('lecture:markDone', (_, { lecturePath, done = true }) => {
  try {
    if (!lecturePath) return { success: false, error: 'Missing lecture path' };
    if (done) {
      markLecturePlannerActivity(lecturePath, 'manual lecture done');
      return { success: true, progress: 'done' };
    }
    updateLectureMeta(lecturePath, (meta) => {
      meta.plannerStatus = 'active';
      meta.progress = inferProgress(meta);
      return meta;
    });
    return { success: true, progress: 'active' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── IPC: PDF Processing ─────────────────────────────────────────────────────

function getOpenAIMessageContent(response) {
  return (response?.choices?.[0]?.message?.content || '').trim();
}

function getGenerationModel() {
  return store.get('generationModel') || 'gpt-4o';
}

function getTemperature(defaultValue) {
  const mode = store.get('generationMode') || 'balanced';
  if (mode === 'precise') return Math.max(0.1, defaultValue - 0.12);
  if (mode === 'exploratory') return Math.min(0.55, defaultValue + 0.12);
  return defaultValue;
}

function resolveCourseForImport({ courseId, courseName } = {}) {
  const courses = store.get('courses') || [];
  if (courseId) {
    const byId = courses.find((c) => c.id === courseId);
    if (byId) return byId;
  }
  if (courseName) {
    const byName = courses.find((c) => c.name === courseName);
    if (byName) return byName;
  }
  return null;
}

async function runPdfProcess(event, { pdfPath, courseName, courseId }) {
  if (pdfProcessingActive) {
    const staleMs = Date.now() - (global.__studyAiPdfLockAt || 0);
    if (staleMs > 45 * 60 * 1000) {
      console.warn('Resetting stale PDF processing lock');
      pdfProcessingActive = false;
    } else {
      return { success: false, error: 'BUSY', message: 'Another PDF is already being processed.' };
    }
  }
  pdfProcessingActive = true;
  global.__studyAiPdfLockAt = Date.now();

  const vaultPath = store.get('vaultPath');
  const apiKey = store.get('apiKey');
  const model = getGenerationModel();
  const course = resolveCourseForImport({ courseId, courseName });

  if (!vaultPath || !apiKey) {
    pdfProcessingActive = false;
    return { success: false, error: 'Missing vault path or API key' };
  }
  if (!course) {
    pdfProcessingActive = false;
    return {
      success: false,
      error: 'INVALID_COURSE',
      message: 'Selected course was not found. Close the dialog and try again.'
    };
  }
  const resolvedCourseName = course.name;

  const sendStatus = (status) => {
    try {
      if (event?.sender && typeof event.sender.isDestroyed === 'function' && !event.sender.isDestroyed()) {
        event.sender.send('pdf:status', status);
      }
    } catch (_) {
      /* window closed */
    }
  };

  try {
    sendStatus({ step: 'extracting', message: 'Extracting text from PDF…' });
    const { extractedText, pdfBaseName, textForAI } = await extractPdfText(pdfPath);

    const courseDir = path.join(vaultPath, sanitizeName(resolvedCourseName));
    fs.mkdirSync(courseDir, { recursive: true });
    pruneOrphanLectureDirs(courseDir);
    sendStatus({ step: 'analyzing', message: 'Analyzing lecture structure…' });
    const semanticLectureName = normalizeLectureName(pdfBaseName, extractedText);
    const sourceFile = path.basename(pdfPath);
    const pdfHash = hashFileSha256(pdfPath);

    const duplicate = findDuplicateLecture(courseDir, {
      pdfPath,
      semanticLectureName,
      pdfHash,
      sourceFile,
      courseName: resolvedCourseName
    });
    if (duplicate) {
      const isGerman = chooseOutputLanguage(resolvedCourseName, extractedText, course) === 'German';
      sendStatus({
        step: 'done',
        message: isGerman ? 'Bereits vorhanden — übersprungen' : 'Already imported — skipped'
      });
      return {
        success: true,
        skipped: true,
        duplicate: true,
        reason: duplicate.reason,
        lectureId: duplicate.folder,
        lectureName: duplicate.lectureName,
        lectureDir: duplicate.path,
        message: duplicate.message
      };
    }

    const { lectureFolder, lectureDir } = allocateUniqueLectureFolder(
      courseDir,
      semanticLectureName,
      pdfPath
    );

    fs.mkdirSync(lectureDir, { recursive: true });
    fs.copyFileSync(pdfPath, path.join(lectureDir, 'original.pdf'));

    sendStatus({ step: 'summary', message: `Generating summary with ${model}…` });

    const { OpenAI } = require('openai');
    const openai = new OpenAI({ apiKey });

    const courseMeta = course;
    const lectureProfile = resolveLectureProfile(courseMeta, extractedText, resolvedCourseName);
    const outputLanguage = chooseOutputLanguage(resolvedCourseName, extractedText, courseMeta);
    let totalTokens = 0;
    let summaryResponse;
    let conceptsResponse;
    let overviewResponse;
    let quizResponse;

    try {
      summaryResponse = await openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: buildSummaryPrompt(outputLanguage, lectureProfile) },
          { role: 'user', content: `Lecture content:\n\n${textForAI}` }
        ],
        temperature: getTemperature(0.3)
      });
      totalTokens += summaryResponse.usage?.total_tokens || 0;
    } catch (apiErr) {
      return {
        success: false,
        error: 'API_ERROR',
        message: apiErr.message,
        lectureDir
      };
    }

    const summaryContent = getOpenAIMessageContent(summaryResponse);
    if (!summaryContent) {
      return { success: false, error: 'API_ERROR', message: 'Model returned an empty summary', lectureDir };
    }

    sendStatus({ step: 'concepts', message: 'Extracting key concepts…' });

    try {
      conceptsResponse = await openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: buildConceptPrompt(outputLanguage, lectureProfile) },
          { role: 'user', content: `Lecture content:\n\n${textForAI}` }
        ],
        temperature: getTemperature(0.3)
      });
      totalTokens += conceptsResponse.usage?.total_tokens || 0;
    } catch (apiErr) {
      return {
        success: false,
        error: 'API_ERROR',
        message: apiErr.message,
        lectureDir
      };
    }

    const conceptsContent = getOpenAIMessageContent(conceptsResponse);
    if (!conceptsContent) {
      return { success: false, error: 'API_ERROR', message: 'Model returned empty key concepts', lectureDir };
    }

    sendStatus({ step: 'overview', message: 'Building conceptual map / overview…' });

    try {
      overviewResponse = await openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: buildOverviewPrompt(outputLanguage, lectureProfile) },
          { role: 'user', content: `Lecture content:\n\n${textForAI}` }
        ],
        temperature: getTemperature(0.2)
      });
      totalTokens += overviewResponse.usage?.total_tokens || 0;
    } catch (apiErr) {
      return {
        success: false,
        error: 'API_ERROR',
        message: apiErr.message,
        lectureDir
      };
    }

    const overviewContent = getOpenAIMessageContent(overviewResponse);
    if (!overviewContent) {
      return { success: false, error: 'API_ERROR', message: 'Model returned empty overview / map', lectureDir };
    }

    sendStatus({ step: 'quiz', message: 'Generating active recall questions…' });

    try {
      quizResponse = await openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: buildLectureQuizPrompt(outputLanguage, lectureProfile, 5) },
          { role: 'user', content: `Lecture content:\n\n${textForAI}` }
        ],
        temperature: getTemperature(0.35)
      });
      totalTokens += quizResponse.usage?.total_tokens || 0;
    } catch (apiErr) {
      return {
        success: false,
        error: 'API_ERROR',
        message: apiErr.message,
        lectureDir
      };
    }

    const quizContent = getOpenAIMessageContent(quizResponse);
    if (!quizContent) {
      return { success: false, error: 'API_ERROR', message: 'Model returned empty quiz', lectureDir };
    }

    sendStatus({ step: 'aufgaben', message: outputLanguage === 'German' ? 'Erstelle Übungsaufgaben…' : 'Building practice exercises…' });

    let aufgabenBundle = null;
    let aufgabenTokens = 0;
    try {
      aufgabenBundle = await generateAufgabenBundle({
        openai,
        model,
        lecturePath: lectureDir,
        courseName: resolvedCourseName,
        meta: { course: resolvedCourseName, courseId: course.id, inferredLectureName: semanticLectureName, outputLanguage, lectureProfile },
        overview: overviewContent,
        summary: summaryContent,
        concepts: conceptsContent,
        extracted: extractedText
      });
      if (aufgabenBundle.success) aufgabenTokens = aufgabenBundle.tokens || 0;
    } catch (aufgabenErr) {
      console.warn('Aufgaben generation skipped:', aufgabenErr.message);
    }

    sendStatus({ step: 'writing', message: 'Writing files to vault…' });

    fs.writeFileSync(path.join(lectureDir, 'summary.md'), summaryContent, 'utf8');
    fs.writeFileSync(path.join(lectureDir, 'concepts.md'), conceptsContent, 'utf8');
    fs.writeFileSync(path.join(lectureDir, 'overview.md'), overviewContent, 'utf8');
    fs.writeFileSync(path.join(lectureDir, 'quiz.md'), quizContent, 'utf8');
    fs.writeFileSync(path.join(lectureDir, 'extracted.txt'), extractedText, 'utf8');

    const provisionalMeta = {
      processedAt: new Date().toISOString(),
      sourceFile: path.basename(pdfPath),
      course: resolvedCourseName,
      courseId: course.id,
      inferredLectureName: semanticLectureName,
      outputLanguage,
      lectureProfile,
      topicHints: extractTopicHints(extractedText),
      prerequisites: inferPrerequisiteHints(resolvedCourseName, semanticLectureName, extractedText)
    };
    let lectureStructure = buildLectureStructure({
      courseName: resolvedCourseName,
      lecturePath: lectureDir,
      meta: provisionalMeta,
      overview: overviewContent,
      summary: summaryContent,
      concepts: conceptsContent,
      extracted: extractedText
    });

    sendStatus({ step: 'naming', message: 'Pruning and renaming study topics…' });
    const renameResult = await refineLectureStructureWithAI({
      openai,
      model,
      courseName: resolvedCourseName,
      meta: provisionalMeta,
      structure: lectureStructure,
      summary: summaryContent,
      concepts: conceptsContent,
      overview: overviewContent,
      extracted: extractedText,
      outputLanguage,
      lectureProfile
    });
    if (renameResult.structure) lectureStructure = renameResult.structure;
    if (renameResult.tokens) totalTokens += renameResult.tokens;
    fs.writeFileSync(path.join(lectureDir, 'lecture_structure.json'), JSON.stringify(lectureStructure, null, 2), 'utf8');

    if (!aufgabenBundle?.success) {
      try {
        aufgabenBundle = await generateAufgabenBundle({
          openai,
          model,
          lecturePath: lectureDir,
          courseName: resolvedCourseName,
          meta: { course: resolvedCourseName, courseId: course.id, inferredLectureName: semanticLectureName, outputLanguage, lectureProfile },
          overview: overviewContent,
          summary: summaryContent,
          concepts: conceptsContent,
          extracted: extractedText,
          lectureStructure
        });
        if (aufgabenBundle.success) aufgabenTokens = aufgabenBundle.tokens || 0;
      } catch (_) {}
    }
    if (aufgabenBundle?.success) {
      writeAufgabenFiles(lectureDir, aufgabenBundle.aufgaben, aufgabenBundle.markdown);
    }

    const displayLectureName = resolveLectureDisplayName(
      { course: resolvedCourseName, inferredLectureName: semanticLectureName, outputLanguage },
      lectureStructure,
      lectureFolder,
      resolvedCourseName
    );

    const meta = {
      processedAt: new Date().toISOString(),
      sourceFile,
      sourceSha256: pdfHash || undefined,
      course: resolvedCourseName,
      courseId: course.id,
      inferredLectureName: displayLectureName,
      sourceTitleFromFile: semanticLectureName,
      outputLanguage,
      lectureProfile,
      generationModel: model,
      generationMode: store.get('generationMode') || 'balanced',
      internalModules: ['pdf-intake', 'course-aware-generation', 'math-stat-profile', 'study-planner'],
      topicHints: lectureStructure.navigableTopics?.map(t => t.label).slice(0, 10) || extractTopicHints(extractedText),
      focusTheme: lectureStructure.focusTheme,
      coreThemes: lectureStructure.coreThemes,
      courseSequence: lectureStructure.courseSequence,
      prerequisites: lectureStructure.prerequisites?.length ? lectureStructure.prerequisites : inferPrerequisiteHints(resolvedCourseName, semanticLectureName, extractedText),
      threadContext: buildLectureThreadContext(resolvedCourseName, lectureDir),
      progress: 'not_started',
      activity: {
        openedCount: 0,
        tabViews: {},
        lastOpenedAt: null,
        lastActiveAt: null
      },
      tokenUsage: {
        summary: summaryResponse.usage?.total_tokens || 0,
        concepts: conceptsResponse.usage?.total_tokens || 0,
        overview: overviewResponse.usage?.total_tokens || 0,
        quiz: quizResponse.usage?.total_tokens || 0,
        aufgaben: aufgabenTokens,
        naming: renameResult.tokens || 0,
        total: totalTokens + aufgabenTokens
      }
    };

    fs.writeFileSync(path.join(lectureDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

    sendStatus({ step: 'done', message: 'Done!' });

    return {
      success: true,
      lectureId: lectureFolder,
      lectureName: displayLectureName,
      lectureDir,
      meta,
      summary: summaryContent,
      concepts: conceptsContent,
      overview: overviewContent,
      quiz: quizContent,
      aufgaben: aufgabenBundle?.aufgaben || null,
      lectureStructure
    };
  } catch (err) {
    console.error('Processing error:', err);
    return { success: false, error: err.code || 'UNKNOWN_ERROR', message: err.message };
  } finally {
    pdfProcessingActive = false;
    global.__studyAiPdfLockAt = 0;
    invalidateCourseRowsCache();
  }
}

ipcMain.handle('pdf:analyze', async (_, { pdfPath }) => {
  try {
    const pdfBaseName = path.basename(pdfPath, '.pdf');
    const courses = store.get('courses') || [];
    let extractedText = '';
    let textSample = '';
    try {
      const raced = await Promise.race([
        extractPdfText(pdfPath),
        new Promise((_, reject) => setTimeout(() => reject(new Error('ANALYZE_TIMEOUT')), 10000))
      ]);
      extractedText = raced.extractedText || '';
      textSample = raced.textForAI || '';
    } catch (_) {
      extractedText = '';
      textSample = '';
    }

    const haystack = `${pdfBaseName}\n${extractedText.slice(0, 4000)}`;
    const bestCourse = chooseSuggestedCourse(courses, haystack);
    const cleanedName = extractedText.length >= 50
      ? normalizeLectureName(pdfBaseName, extractedText)
      : pdfBaseName.replace(/_/g, ' ').trim();
    const topicHints = extractedText.length >= 50 ? extractTopicHints(extractedText).slice(0, 6) : [];

    return {
      success: true,
      suggestedCourseId: bestCourse?.id || null,
      confidence: bestCourse?.confidence || 0,
      suggestedLectureName: cleanedName,
      topicHints,
      previewText: textSample.slice(0, 600),
      quickOnly: !extractedText.length
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('pdf:process', async (event, payload) => runPdfProcess(event, payload));

ipcMain.handle('lecture:generateOverview', async (_, { lecturePath }) => {
  const apiKey = store.get('apiKey');
  if (!apiKey) {
    return { success: false, error: 'Missing API key' };
  }
  try {
    const meta = safeJson(path.join(lecturePath, 'meta.json')) || {};
    const summary = safeRead(path.join(lecturePath, 'summary.md'));
    const concepts = safeRead(path.join(lecturePath, 'concepts.md'));
    const extracted = safeRead(path.join(lecturePath, 'extracted.txt'));
    const outputLanguage = readLectureLanguage(lecturePath, `${summary}\n${concepts}`);
    if (!summary && !concepts) {
      return { success: false, error: 'No lecture content available to generate overview' };
    }
    const courseMeta = getCourseMetaByName(meta.course || '');
    const lectureProfile = resolveLectureProfile(courseMeta, `${summary}\n${concepts}\n${extracted}`, meta.course || '');
    const { OpenAI } = require('openai');
    const openai = new OpenAI({ apiKey });
    const response = await openai.chat.completions.create({
      model: getGenerationModel(),
      messages: [
        { role: 'system', content: buildOverviewPrompt(outputLanguage, lectureProfile) },
        { role: 'user', content: `Summary:\n${summary}\n\nConcepts:\n${concepts}\n\nSource excerpt:\n${extracted.slice(0, 24000)}` }
      ],
      temperature: getTemperature(0.2)
    });
    const overview = response.choices?.[0]?.message?.content || '';
    fs.writeFileSync(path.join(lecturePath, 'overview.md'), overview, 'utf8');

    let structure = safeJson(path.join(lecturePath, 'lecture_structure.json'))
      || buildLectureStructure({ courseName: meta.course || '', lecturePath, meta, overview, summary, concepts, extracted });
    structure = enrichStructureFromOverview(structure, overview, outputLanguage);
    structure = ensureLectureStructureFields(structure, { courseName: meta.course || '', lecturePath, meta, overview });
    fs.writeFileSync(path.join(lecturePath, 'lecture_structure.json'), JSON.stringify(structure, null, 2), 'utf8');
    invalidateCourseRowsCache();

    return { success: true, overview, lectureStructure: structure, lectureProfile };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('lecture:generateDeepDive', async (_, { lecturePath, topic, mode = 'explain' }) => {
  const apiKey = store.get('apiKey');
  if (!apiKey) return { success: false, error: 'Missing API key' };
  if (!topic?.trim()) return { success: false, error: 'Missing topic' };
  const diveMode = String(mode || 'explain').toLowerCase();
  try {
    const meta = safeJson(path.join(lecturePath, 'meta.json')) || {};
    const summary = safeRead(path.join(lecturePath, 'summary.md'));
    const concepts = safeRead(path.join(lecturePath, 'concepts.md'));
    const overview = safeRead(path.join(lecturePath, 'overview.md'));
    const extracted = safeRead(path.join(lecturePath, 'extracted.txt'));
    const lectureStructure = buildLectureStructure({ courseName: meta.course || '', lecturePath, meta, overview, summary, concepts, extracted });
    const threadContext = buildLectureThreadContextFromMaterials(lecturePath, { overview, summary, concepts, extracted, lectureStructure });
    const lectureContent = `${formatLectureStructureForPrompt(lectureStructure)}\n\n${threadContext.markdown}\n\n${overview}\n\n${summary}\n\n${concepts}\n\n${extracted.slice(0, 30000)}`.trim();
    if (!lectureContent) return { success: false, error: 'No lecture materials available' };
    const outputLanguage = readLectureLanguage(lecturePath, lectureContent);
    const lectureProfile = readLectureProfile(lecturePath, lectureContent);
    const topicCtx = findDeepDiveTopicContext(lectureStructure, topic);
    const compareContext = diveMode === 'compare'
      ? getPriorLectureMaterials(meta.course || '', lecturePath)
      : '';

    const { OpenAI } = require('openai');
    const openai = new OpenAI({ apiKey });
    const response = await openai.chat.completions.create({
      model: getGenerationModel(),
      messages: [
        {
          role: 'system',
          content: buildDeepDivePromptForMode(outputLanguage, lectureProfile, topic, diveMode, compareContext, topicCtx)
        },
        {
          role: 'user',
          content: `Course profile: ${profileLabel(lectureProfile, outputLanguage)} (${lectureProfile})
Topic: ${topic}${topicCtx.parent ? `\nParent theme: ${topicCtx.parent}` : ''}
Mode: ${diveMode}

Lecture materials:\n${lectureContent}`
        }
      ],
      temperature: getTemperature(0.3)
    });
    const deepDive = response.choices?.[0]?.message?.content || '';
    if (!deepDive.trim()) return { success: false, error: 'Model returned empty deep dive' };

    const topicSlug = slugify(topic);
    const deepDiveDir = path.join(lecturePath, 'deep_dives');
    fs.mkdirSync(deepDiveDir, { recursive: true });
    const deepDivePath = deepDiveModeFilePath(lecturePath, topicSlug, diveMode);
    fs.writeFileSync(deepDivePath, deepDive, 'utf8');
    if (diveMode === 'explain') {
      fs.writeFileSync(path.join(deepDiveDir, `${topicSlug}.md`), deepDive, 'utf8');
    }

    const indexPath = path.join(deepDiveDir, 'index.json');
    let index = [];
    try { index = JSON.parse(fs.readFileSync(indexPath, 'utf8')); } catch {}
    const now = new Date().toISOString();
    let existing = index.find((e) => e.slug === topicSlug);
    if (!existing) {
      existing = { slug: topicSlug, topic, modes: {}, createdAt: now, language: outputLanguage, lectureProfile };
      index.push(existing);
    }
    existing.topic = topic;
    existing.updatedAt = now;
    existing.modes = existing.modes || {};
    existing.modes[diveMode] = now;
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');
    const deepStudy = recordDeepStudyExplore(lecturePath, {
      topic,
      subtopic: '',
      parentTopic: topicCtx.parent || '',
      mode: diveMode,
      slug: topicSlug
    });
    return { success: true, topic, slug: topicSlug, mode: diveMode, deepDive, deepStudy };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('lecture:generateSubtopicDive', async (_, { lecturePath, topicSlug, subtopic, parentTopic }) => {
  const apiKey = store.get('apiKey');
  if (!apiKey) return { success: false, error: 'Missing API key' };
  if (!subtopic?.trim()) return { success: false, error: 'Missing subtopic' };
  try {
    const deepDivePath = path.join(lecturePath, 'deep_dives', `${topicSlug}.md`);
    const deepDive = safeRead(deepDivePath);
    if (!deepDive.trim()) return { success: false, error: 'Generate topic deep dive first' };
    const outputLanguage = readLectureLanguage(lecturePath, deepDive);
    const lectureProfile = readLectureProfile(lecturePath, deepDive);

    const { OpenAI } = require('openai');
    const openai = new OpenAI({ apiKey });
    const response = await openai.chat.completions.create({
      model: getGenerationModel(),
      messages: [
        {
          role: 'system',
          content: buildSubtopicPrompt(outputLanguage, lectureProfile, subtopic)
        },
        {
          role: 'user',
          content: `Subtopic: ${subtopic}\n\nParent deep dive:\n${deepDive}`
        }
      ],
      temperature: getTemperature(0.3)
    });
    const subtopicDive = response.choices?.[0]?.message?.content || '';
    if (!subtopicDive.trim()) return { success: false, error: 'Model returned empty subtopic dive' };

    const subSlug = slugify(subtopic);
    const outPath = path.join(lecturePath, 'deep_dives', `${topicSlug}_sub_${subSlug}.md`);
    fs.writeFileSync(outPath, subtopicDive, 'utf8');
    let parent = parentTopic || '';
    try {
      const index = JSON.parse(fs.readFileSync(path.join(lecturePath, 'deep_dives', 'index.json'), 'utf8'));
      const hit = index.find((e) => e.slug === topicSlug);
      if (hit?.topic) parent = parent || hit.topic;
    } catch (_) {}
    const deepStudy = recordDeepStudyExplore(lecturePath, {
      topic: parent || subtopic,
      subtopic,
      parentTopic: parent,
      mode: 'subtopic',
      slug: topicSlug
    });
    return { success: true, subtopic, subSlug, subtopicDive, parentTopic: parent, deepStudy };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('lecture:generateTopicQuiz', async (_, { lecturePath, topicSlug, difficulty = 'medium', questionCount = 5 }) => {
  const apiKey = store.get('apiKey');
  if (!apiKey) return { success: false, error: 'Missing API key' };
  try {
    const deepDive = safeRead(path.join(lecturePath, 'deep_dives', `${topicSlug}.md`));
    if (!deepDive.trim()) return { success: false, error: 'Generate topic deep dive first' };

    const outputLanguage = readLectureLanguage(lecturePath, deepDive);
    const lectureProfile = readLectureProfile(lecturePath, deepDive);
    const { OpenAI } = require('openai');
    const openai = new OpenAI({ apiKey });
    const count = Math.max(3, Math.min(10, Number(questionCount) || 5));
    const response = await openai.chat.completions.create({
      model: getGenerationModel(),
      messages: [
        {
          role: 'system',
          content: buildInteractiveQuizPrompt(outputLanguage, lectureProfile, count, difficulty)
        },
        { role: 'user', content: deepDive }
      ],
      temperature: getTemperature(0.35)
    });
    const raw = response.choices?.[0]?.message?.content || '';
    const parsed = parseQuizJson(raw);
    if (!parsed?.questions?.length) return { success: false, error: 'Model returned invalid quiz JSON' };
    const quiz = normalizeQuiz(parsed, { language: outputLanguage, topicSlug, difficulty, count });
    const outPath = path.join(lecturePath, 'deep_dives', `${topicSlug}_quiz_${difficulty}.json`);
    fs.writeFileSync(outPath, JSON.stringify(quiz, null, 2), 'utf8');
    return { success: true, quiz };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('lecture:loadTopicQuiz', (_, { lecturePath, topicSlug, difficulty = 'medium' }) => {
  try {
    const outPath = path.join(lecturePath, 'deep_dives', `${topicSlug}_quiz_${difficulty}.json`);
    if (!fs.existsSync(outPath)) return { success: false, error: 'Quiz not found' };
    const attemptsPath = path.join(lecturePath, 'deep_dives', `${topicSlug}_quiz_${difficulty}_attempts.json`);
    let attempts = [];
    try { attempts = JSON.parse(fs.readFileSync(attemptsPath, 'utf8')); } catch {}
    return { success: true, quiz: JSON.parse(fs.readFileSync(outPath, 'utf8')), attempts };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('lecture:saveQuizAttempt', (_, { lecturePath, topicSlug, difficulty = 'medium', answers = {}, score = {} }) => {
  try {
    if (!lecturePath || !topicSlug) return { success: false, error: 'Missing quiz identity' };
    const outDir = path.join(lecturePath, 'deep_dives');
    fs.mkdirSync(outDir, { recursive: true });
    const attemptsPath = path.join(outDir, `${topicSlug}_quiz_${difficulty}_attempts.json`);
    let attempts = [];
    try { attempts = JSON.parse(fs.readFileSync(attemptsPath, 'utf8')); } catch {}
    const attempt = {
      id: Date.now().toString(),
      completedAt: new Date().toISOString(),
      answers,
      score
    };
    attempts.unshift(attempt);
    fs.writeFileSync(attemptsPath, JSON.stringify(attempts.slice(0, 20), null, 2), 'utf8');
    updateMetaAfterQuiz(lecturePath, score);
    return { success: true, attempt };
  } catch (err) {
    return { success: false, error: err.message };
  }
});


ipcMain.handle('lecture:generateLectureQuizInteractive', async (_, { lecturePath, difficulty = 'medium', questionCount = 6 }) => {
  const apiKey = store.get('apiKey');
  if (!apiKey) return { success: false, error: 'Missing API key' };
  try {
    const summary = safeRead(path.join(lecturePath, 'summary.md'));
    const concepts = safeRead(path.join(lecturePath, 'concepts.md'));
    const overview = safeRead(path.join(lecturePath, 'overview.md'));
    const extracted = safeRead(path.join(lecturePath, 'extracted.txt'));
    const meta = safeJson(path.join(lecturePath, 'meta.json')) || {};
    const lectureStructure = buildLectureStructure({ lecturePath, meta, overview, summary, concepts, extracted });
    const threadContext = buildLectureThreadContextFromMaterials(lecturePath, { overview, summary, concepts, extracted, lectureStructure });
    const content = [formatLectureStructureForPrompt(lectureStructure), threadContext.markdown, overview, summary, concepts, extracted.slice(0, 28000)].join('\n\n').trim();
    if (!content) return { success: false, error: 'No lecture content available' };
    const outputLanguage = readLectureLanguage(lecturePath, content);
    const lectureProfile = readLectureProfile(lecturePath, content);
    const { OpenAI } = require('openai');
    const openai = new OpenAI({ apiKey });
    const count = Math.max(4, Math.min(12, Number(questionCount) || 6));
    const response = await openai.chat.completions.create({
      model: getGenerationModel(),
      messages: [
        { role: 'system', content: buildInteractiveQuizPrompt(outputLanguage, lectureProfile, count, difficulty) },
        { role: 'user', content: `Course: ${meta.course || ''}\nLecture: ${meta.inferredLectureName || ''}\n\nLecture materials:\n${content}` }
      ],
      temperature: getTemperature(0.3)
    });
    const parsed = parseQuizJson(response.choices?.[0]?.message?.content || '');
    if (!parsed?.questions?.length) return { success: false, error: 'Model returned invalid quiz JSON' };
    const quiz = normalizeQuiz(parsed, { language: outputLanguage, topicSlug: 'whole-lecture', difficulty, count });
    const outPath = path.join(lecturePath, 'interactive_quiz.json');
    fs.writeFileSync(outPath, JSON.stringify(quiz, null, 2), 'utf8');
    return { success: true, quiz };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('lecture:loadLectureQuizInteractive', (_, { lecturePath }) => {
  try {
    const quizPath = path.join(lecturePath, 'interactive_quiz.json');
    if (!fs.existsSync(quizPath)) return { success: false, error: 'Quiz not found' };
    const attemptsPath = path.join(lecturePath, 'interactive_quiz_attempts.json');
    let attempts = [];
    try { attempts = JSON.parse(fs.readFileSync(attemptsPath, 'utf8')); } catch {}
    return { success: true, quiz: JSON.parse(fs.readFileSync(quizPath, 'utf8')), attempts };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('lecture:saveLectureQuizAttempt', (_, { lecturePath, answers = {}, score = {} }) => {
  try {
    if (!lecturePath) return { success: false, error: 'Missing lecture path' };
    const attemptsPath = path.join(lecturePath, 'interactive_quiz_attempts.json');
    let attempts = [];
    try { attempts = JSON.parse(fs.readFileSync(attemptsPath, 'utf8')); } catch {}
    const attempt = { id: Date.now().toString(), completedAt: new Date().toISOString(), answers, score };
    attempts.unshift(attempt);
    fs.writeFileSync(attemptsPath, JSON.stringify(attempts.slice(0, 20), null, 2), 'utf8');
    updateMetaAfterQuiz(lecturePath, score);
    return { success: true, attempt };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('lecture:delete', (_, { lecturePath }) => {
  try {
    if (!lecturePath) return { success: false, error: 'No lecture path provided' };

    // Safety: the lecture path must sit inside the configured vault
    const vaultPath = store.get('vaultPath');
    if (!vaultPath) return { success: false, error: 'Vault path not configured' };
    const resolvedLecture = path.resolve(lecturePath);
    const resolvedVault = path.resolve(vaultPath);
    if (!resolvedLecture.startsWith(resolvedVault + path.sep)) {
      return { success: false, error: 'Lecture path is outside the vault — refusing to delete' };
    }

    // Must be exactly two levels deep: vault/course/lecture
    const rel = path.relative(resolvedVault, resolvedLecture);
    const parts = rel.split(path.sep);
    if (parts.length !== 2 || parts.some(p => p === '..' || p === '')) {
      return { success: false, error: 'Invalid lecture path depth — refusing to delete' };
    }

    if (!fs.existsSync(resolvedLecture)) return { success: false, error: 'Lecture folder not found on disk' };
    if (!fs.statSync(resolvedLecture).isDirectory()) return { success: false, error: 'Lecture path is not a directory' };

    fs.rmSync(resolvedLecture, { recursive: true, force: true });

    // Verify it is gone
    if (fs.existsSync(resolvedLecture)) {
      return { success: false, error: 'Folder still exists after delete — check file permissions' };
    }

    invalidateCourseRowsCache();
    return { success: true, deletedPath: resolvedLecture };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('lecture:askQuick', async (_, { lecturePath, question, activeTab, courseName, lectureTitle }) => {
  const apiKey = store.get('apiKey');
  const q = (question || '').trim();
  if (!q) return { success: false, error: 'Empty question' };
  try {
    const summary = safeRead(path.join(lecturePath, 'summary.md'));
    const concepts = safeRead(path.join(lecturePath, 'concepts.md'));
    const overview = safeRead(path.join(lecturePath, 'overview.md'));
    const extracted = safeRead(path.join(lecturePath, 'extracted.txt'));
    const notes = safeRead(path.join(lecturePath, 'notes.md'));
    const lectureStructure = buildLectureStructure({ lecturePath, meta: safeJson(path.join(lecturePath, 'meta.json')) || {}, overview, summary, concepts, extracted });
    const threadContext = buildLectureThreadContextFromMaterials(lecturePath, { overview, summary, concepts, extracted, lectureStructure });
    const combined = [
      `Course: ${courseName || ''}`,
      `Lecture: ${lectureTitle || ''}`,
      '--- Lecture structure ---',
      formatLectureStructureForPrompt(lectureStructure),
      '--- Thread / prerequisites ---',
      threadContext.markdown,
      '--- Student notes ---',
      notes.slice(0, 6000),
      '--- Overview ---',
      overview.slice(0, 12000),
      '--- Summary ---',
      summary.slice(0, 12000),
      '--- Key concepts ---',
      concepts.slice(0, 12000),
      '--- Source excerpt ---',
      extracted.slice(0, 20000)
    ].join('\n\n');
    if (!summary.trim() && !concepts.trim() && !overview.trim() && !extracted.trim() && !notes.trim()) {
      return { success: false, error: 'No lecture content loaded yet' };
    }
    const outputLanguage = readLectureLanguage(lecturePath, combined);
    if (!apiKey) {
      const answer = buildOfflineLectureAnswer(q, combined, outputLanguage);
      const deepStudy = recordDeepStudyQuestion(lecturePath, q, activeTab);
      return { success: true, answer, deepStudy };
    }
    const { OpenAI } = require('openai');
    const openai = new OpenAI({ apiKey });
    const response = await openai.chat.completions.create({
      model: getGenerationModel(),
      messages: [
        {
          role: 'system',
          content: `You are StudyAI's compact lecture assistant. Write in ${outputLanguage}. Answer ONLY from the provided lecture materials, generated artifacts, thread context, and student notes. Be practical: explain symbols, assumptions, method differences, prerequisite order, lecture dependencies, next steps, or common mistakes when asked. For math/statistics, preserve formulas in LaTeX and give step logic. Stay concise unless the question asks for a worked explanation. If the material does not contain enough evidence, say exactly what is missing. Current tab: ${activeTab || 'general'}.`
        },
        {
          role: 'user',
          content: `Materials:\n${combined}\n\n---\nStudent question:\n${q}`
        }
      ],
      temperature: getTemperature(0.25),
      max_tokens: 900
    });
    const answer = response.choices?.[0]?.message?.content?.trim() || '';
    if (!answer) return { success: false, error: 'Empty answer from model' };
    const deepStudy = recordDeepStudyQuestion(lecturePath, q, activeTab);
    return { success: true, answer, deepStudy };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('pdf:reprocess', async (event, { lectureDir, courseName }) => {
  const pdfPath = path.join(lectureDir, 'original.pdf');
  if (!fs.existsSync(pdfPath)) {
    return { success: false, error: 'PDF not found in lecture folder' };
  }
  return runPdfProcess(event, { pdfPath, courseName });
});

// Helper



async function refineLectureStructureWithAI({ openai, model, courseName, meta, structure, summary, concepts, overview, extracted, outputLanguage, lectureProfile }) {
  if (!openai || !model || !structure?.deepDiveTopics?.length) return { structure, tokens: 0 };
  try {
    const candidatePayload = {
      lectureTitle: meta.inferredLectureName || '',
      courseName,
      language: outputLanguage,
      profile: lectureProfile,
      profileLabel: profileLabel(lectureProfile, outputLanguage),
      currentFocus: structure.focusTheme,
      currentCoreThemes: structure.coreThemes || [],
      currentDeepDiveTopics: (structure.deepDiveTopics || []).map(t => ({ label: t.label, role: t.role, parent: t.parent || '', why: t.why || '' })),
      rejectedLegacyHints: structure.quality?.rejectedLegacyHints || []
    };
    const response = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: buildTopicRenamingPrompt(outputLanguage, lectureProfile) },
        { role: 'user', content: `Candidate topic JSON:\n${JSON.stringify(candidatePayload, null, 2)}\n\nConcepts layer:\n${concepts.slice(0, 14000)}\n\nOverview:\n${overview.slice(0, 9000)}\n\nSummary excerpt:\n${summary.slice(0, 8000)}\n\nSource excerpt:\n${extracted.slice(0, 16000)}` }
      ],
      temperature: getTemperature(0.12),
      max_tokens: 1200
    });
    const raw = response.choices?.[0]?.message?.content || '';
    const parsed = parseJsonObject(raw);
    let refined = applySemanticTopicNaming(structure, parsed, { outputLanguage, courseName, meta, concepts, overview, summary, extracted });
    if (refined && overview) refined = enrichStructureFromOverview(refined, overview, outputLanguage);
    return { structure: refined || structure, tokens: response.usage?.total_tokens || 0 };
  } catch (err) {
    console.warn('Topic renaming fallback:', err.message);
    return { structure, tokens: 0, error: err.message };
  }
}

function buildTopicRenamingPrompt(language, profile = 'conceptual') {
  const isGerman = language === 'German';
  const profileRules = profile === 'programming'
    ? (isGerman
      ? '- PROGRAMMIERUNG: Mindestens 2 Kernthemen mit je 2–5 Unterthemen (z. B. def foo, Klassen, Schleifen, Fehler). Unterthemen = konkrete Code-Bausteine aus der Vorlesung, nicht abstrakte CS-Theorie.'
      : '- PROGRAMMING: At least 2 core themes with 2–5 subtopics each (e.g. def foo, classes, loops, bugs). Subtopics = concrete code pieces from the lecture, not abstract CS theory.')
    : profile === 'math_stats'
      ? (isGerman
        ? '- MATHE/STATISTIK: Kernthemen + Unterthemen für Formeln, Verfahren, Annahmen.'
        : '- MATH/STATS: Core themes + subtopics for formulas, procedures, assumptions.')
      : (isGerman
        ? '- Mindestens 1 Kernthema mit 2–4 Unterthemen, wenn die Vorlesung das hergibt.'
        : '- At least 1 core theme with 2–4 subtopics when the lecture supports it.');

  return `You are StudyAI's concept naming filter. Prune and rename lecture topics into a hierarchical study set. Write labels in ${language}. Return strict JSON only.

Rules:
- Use Concepts and Overview (Unterthemen/Subtopics) as strongest evidence.
- Remove admin/logistics/person names unless conceptually central.
- Prefer 3–6 topics total with clear parent/child links.
- Labels must be short and study-useful; do not invent topics absent from materials.
${profileRules}
- For German lectures, labels and why-text must be German.

JSON schema:
{
  "focusTheme": "${isGerman ? 'kurzes deutsches Fokusthema' : 'short focus theme'}",
  "topics": [
    { "label": "clean concept label", "role": "${isGerman ? 'Fokusthema|Kernthema|Unterthema|Konzept' : 'Focus theme|Core theme|Subtopic|Concept'}", "parent": "optional parent label", "why": "one short reason why this is worth a Deep Dive" }
  ]
}`;
}

function parseJsonObject(raw = '') {
  const text = String(raw || '').trim();
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const payload = fenced ? fenced[1].trim() : text;
  try { return JSON.parse(payload); } catch {}
  const start = payload.indexOf('{');
  const end = payload.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(payload.slice(start, end + 1)); } catch {}
  }
  return null;
}

function applySemanticTopicNaming(structure, parsed, ctx = {}) {
  if (!parsed || !Array.isArray(parsed.topics)) return null;
  const language = ctx.outputLanguage || structure.language || 'German';
  const courseTerms = buildCourseTermSet(ctx.courseName, ctx.meta || {});
  const cleaned = [];
  const pushTopic = (topic, fallbackRole = '') => {
    const label = polishDeepDiveLabel(cleanTopicLabel(topic?.label || '', language, courseTerms), language);
    if (!label || isBadTopicLabel(label, { raw: topic?.label || '', source: 'ai-rename', language, courseName: ctx.courseName, meta: ctx.meta })) return;
    const score = scoreTopicCandidate(label, { raw: label, source: 'ai-rename', language, courseName: ctx.courseName, meta: ctx.meta, extracted: `${ctx.concepts || ''}\n${ctx.overview || ''}\n${ctx.summary || ''}\n${ctx.extracted || ''}` });
    if (score < 3.5) return;
    if (cleaned.some(t => topicLooseMatch(t.label, label))) return;
    const parent = topic?.parent ? polishDeepDiveLabel(cleanTopicLabel(topic.parent, language, courseTerms), language) : '';
    cleaned.push({
      label,
      rawLabel: topic?.label || label,
      role: normalizeTopicRole(topic?.role || fallbackRole, language),
      parent: parent && !topicLooseMatch(parent, label) ? parent : '',
      why: cleanTopicWhy(topic?.why || '', language),
      semanticSource: 'llm-renamed'
    });
  };
  const focus = polishDeepDiveLabel(cleanTopicLabel(parsed.focusTheme || structure.focusTheme || '', language, courseTerms), language);
  if (focus) pushTopic({ label: focus, role: language === 'German' ? 'Fokusthema' : 'Focus theme', why: language === 'German' ? 'Zentrum der Vorlesung; bester Einstieg für einen Deep Dive.' : 'Center of the lecture; best first deep dive.' });
  for (const topic of parsed.topics.slice(0, 8)) pushTopic(topic);
  if (cleaned.length < 3) return null;
  const finalTopics = cleaned.slice(0, 6).map((topic, index) => ({
    ...topic,
    role: index === 0 ? (language === 'German' ? 'Fokusthema' : 'Focus theme') : topic.role,
    why: topic.why || buildDeepDiveReason({ label: topic.label, role: topic.role, parent: topic.parent, recurrence: null, prerequisites: structure.prerequisites || [], language })
  }));
  const focusTheme = finalTopics[0].label;
  const coreThemes = finalTopics.filter(t => !t.parent).map(t => t.label).slice(0, 5);
  const topicTree = finalTopics.filter(t => !t.parent).slice(0, 4).map((topic, idx) => ({
    id: slugify(`${idx + 1}-${topic.label}`) || `theme-${idx + 1}`,
    label: topic.label,
    role: topic.role,
    subtopics: finalTopics.filter(t => t.parent && topicLooseMatch(t.parent, topic.label)).map(t => t.label).slice(0, 3)
  }));
  const navigableTopics = finalTopics.map(topic => ({ label: topic.label, role: topic.role, parent: topic.parent || '', recurrence: null }));
  return {
    ...structure,
    version: 5,
    semanticNaming: { provider: 'llm', appliedAt: new Date().toISOString() },
    focusTheme,
    coreThemes: coreThemes.length ? coreThemes : [focusTheme],
    topicTree: topicTree.length ? topicTree : [{ id: slugify(focusTheme), label: focusTheme, role: finalTopics[0].role, subtopics: finalTopics.slice(1, 4).map(t => t.label) }],
    navigableTopics: uniqueTopicObjects(navigableTopics).slice(0, 8),
    deepDiveTopics: finalTopics,
    studyPath: buildStudyPath({ topicTree, courseSequence: structure.courseSequence, recurringThemes: structure.recurringThemes, focusTheme }, language)
  };
}

function normalizeTopicRole(role = '', language = 'German') {
  const lower = String(role || '').toLowerCase();
  const isGerman = language === 'German';
  if (/focus|fokus/.test(lower)) return isGerman ? 'Fokusthema' : 'Focus theme';
  if (/sub|unter/.test(lower)) return isGerman ? 'Unterthema' : 'Subtopic';
  if (/core|kern/.test(lower)) return isGerman ? 'Kernthema' : 'Core theme';
  return isGerman ? 'Konzept' : 'Concept';
}

function cleanTopicWhy(value = '', language = 'German') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length > 180) return '';
  if (isBadTopicLabel(text, { raw: text, language })) return '';
  return text;
}

function buildLectureStructure({ courseName = '', lecturePath = '', meta = {}, overview = '', summary = '', concepts = '', extracted = '' }) {
  const cached = lecturePath ? safeJson(path.join(lecturePath, 'lecture_structure.json')) : null;
  if (cached?.deepDiveTopics?.length && cached.version >= 5) return cached;
  const language = meta.outputLanguage || detectLanguage(`${courseName}
${meta.inferredLectureName || ''}
${overview}
${summary}
${concepts}
${extracted.slice(0, 22000)}`);
  const isGerman = language === 'German';
  const courseTerms = buildCourseTermSet(courseName, meta);
  const lectureTitle = cleanLectureTitle(meta.inferredLectureName || meta.sourceFile || '', language, courseTerms);
  const candidateMap = new Map();
  const addCandidate = (raw, source, weight = 1) => {
    const clean = cleanTopicLabel(raw, language, courseTerms);
    if (!clean) return;
    const score = scoreTopicCandidate(clean, { raw, source, language, courseName, meta, extracted });
    if (score < 4.2) return;
    const key = topicCanonicalKey(clean);
    const existing = candidateMap.get(key);
    const entry = { label: clean, score: score + weight, sources: [source], canonical: key };
    if (!existing || entry.score > existing.score) candidateMap.set(key, existing ? { ...entry, sources: [...new Set([...existing.sources, source])] } : entry);
  };

  if (lectureTitle && scoreTopicCandidate(lectureTitle, { raw: lectureTitle, source: 'title', language, courseName, meta, extracted }) >= 4) {
    addCandidate(lectureTitle, 'title', 3.5);
  }
  for (const item of extractAgendaTopics(extracted, lectureTitle || meta.inferredLectureName || '')) addCandidate(item, 'agenda', 2.7);
  for (const item of extractDefinitionTableTerms(extracted)) addCandidate(item, 'definition-table', 2.3);
  for (const item of extractConceptualBullets(extracted)) addCandidate(item, 'bullet', 1.2);
  for (const item of extractBoldTerms(concepts)) addCandidate(item, 'concepts-bold', 2.2);
  for (const item of extractBoldTerms(overview)) addCandidate(item, 'overview-bold', 1.6);
  for (const item of extractTopicHints(`${concepts}\n${overview}\n${summary}`).slice(0, 24)) addCandidate(item, 'generated', 1.0);
  for (const item of (Array.isArray(meta.topicHints) ? meta.topicHints : [])) addCandidate(item, 'legacy-hint', 0.15);

  let candidates = [...candidateMap.values()]
    .filter((item) => !isNearCourseMetadata(item.label, courseName, meta))
    .sort((a, b) => b.score - a.score);
  candidates = dedupeTopicCandidates(candidates).slice(0, 10);

  const fallback = lectureTitle && !isNearCourseMetadata(lectureTitle, courseName, meta) ? lectureTitle : normalizeLectureName(courseName || 'Vorlesung', extracted);
  const titleCandidate = lectureTitle && !isBadTopicLabel(lectureTitle, { raw: lectureTitle, source: 'title', language, courseName, meta }) ? lectureTitle : '';
  const focusTheme = titleCandidate || candidates[0]?.label || fallback;
  const coreThemes = dedupeTopicLabels(candidates.map(c => c.label).filter(label => !topicLooseMatch(label, focusTheme))).slice(0, 5);
  const themeBase = coreThemes.length ? coreThemes : [focusTheme];
  const remaining = candidates.map(c => c.label).filter(label => !themeBase.some(theme => topicLooseMatch(theme, label)) && !topicLooseMatch(label, focusTheme));
  const topicTree = themeBase.slice(0, 4).map((theme, idx) => {
    const subtopics = remaining
      .filter(label => label !== theme)
      .filter((label, i) => topicBelongsUnder(label, theme) || i % Math.max(1, Math.min(3, coreThemes.length)) === idx % Math.max(1, Math.min(3, coreThemes.length)))
      .slice(0, idx === 0 ? 5 : 3);
    return {
      id: slugify(`${idx + 1}-${theme}`) || `theme-${idx + 1}`,
      label: theme,
      role: idx === 0 ? (isGerman ? 'Fokusthema' : 'Focus theme') : (isGerman ? 'Kernthema' : 'Core theme'),
      subtopics
    };
  }).filter(theme => scoreTopicCandidate(theme.label, { raw: theme.label, source: 'final', language, courseName, meta, extracted }) >= 4);

  const courseMetaForProfile = getCourseMetaByName(courseName || meta.course || '');
  const lectureProfile = resolveLectureProfile(courseMetaForProfile, extracted, courseName || meta.course || '');
  if (lectureProfile === 'programming') {
    const codeSubs = extractProgrammingSubtopics(extracted);
    if (codeSubs.length && topicTree.length) {
      topicTree[0].subtopics = dedupeTopicLabels([...(topicTree[0].subtopics || []), ...codeSubs]).slice(0, 6);
    }
  }

  const finalLabels = dedupeTopicLabels([focusTheme, ...topicTree.flatMap(t => [t.label, ...(t.subtopics || [])])]).filter(label => scoreTopicCandidate(label, { raw: label, source: 'final', language, courseName, meta, extracted }) >= 4);
  const recurringThemes = findRecurringThemesForLecture(courseName || meta.course || '', lecturePath, finalLabels, language, meta.inferredLectureName || '');
  const prerequisites = buildPrerequisiteModel(courseName || meta.course || '', lecturePath, finalLabels, meta, language);
  const navigableTopics = [];
  for (const theme of topicTree) {
    navigableTopics.push({ label: theme.label, role: theme.role, parent: '', recurrence: recurringThemes.find(r => topicLooseMatch(r.label, theme.label)) || null });
    for (const sub of theme.subtopics || []) navigableTopics.push({ label: sub, role: isGerman ? 'Unterthema' : 'Subtopic', parent: theme.label, recurrence: recurringThemes.find(r => topicLooseMatch(r.label, sub)) || null });
  }
  const deepDiveSections = buildDeepDiveSections({ focusTheme, topicTree, recurringThemes, prerequisites, language });
  const deepDiveTopics = flattenDeepDiveSections(deepDiveSections);
  const courseSequence = buildCourseSequenceEntry(courseName || meta.course || '', lecturePath, meta);
  const structure = {
    version: 5,
    language,
    semanticNaming: { provider: 'deterministic', appliedAt: new Date().toISOString() },
    focusTheme,
    coreThemes: themeBase.slice(0, 5),
    topicTree,
    navigableTopics: uniqueTopicObjects(navigableTopics).slice(0, 12),
    deepDiveSections,
    deepDiveTopics,
    courseSequence,
    prerequisites,
    recurringThemes,
    studyPath: buildStudyPath({ topicTree, courseSequence, recurringThemes, focusTheme }, language),
    quality: {
      candidateCount: candidates.length,
      rejectedLegacyHints: (Array.isArray(meta.topicHints) ? meta.topicHints : []).filter(h => !finalLabels.some(label => topicLooseMatch(label, h))).slice(0, 12)
    },
    generatedAt: new Date().toISOString()
  };
  return structure;
}

function buildDeepDiveSections({ focusTheme, topicTree = [], recurringThemes = [], prerequisites = [], language = 'German' }) {
  const isGerman = language === 'German';
  const sections = [];
  const seenThemes = new Set();
  const trees = (topicTree || []).slice(0, 6);

  const mkWhy = (label, role, parent) =>
    buildDeepDiveReason({
      label,
      role,
      parent,
      recurrence: recurringThemes.find((r) => topicLooseMatch(r.label, label)) || null,
      prerequisites,
      language
    });

  for (const theme of trees) {
    const themeLabel = polishDeepDiveLabel(theme.label, language);
    if (!themeLabel || seenThemes.has(topicCanonicalKey(themeLabel))) continue;
    seenThemes.add(topicCanonicalKey(themeLabel));
    const themeRole = theme.role || (topicLooseMatch(themeLabel, focusTheme) ? (isGerman ? 'Fokusthema' : 'Focus theme') : (isGerman ? 'Kernthema' : 'Core theme'));
    const subtopics = (theme.subtopics || [])
      .map((sub) => polishDeepDiveLabel(sub, language))
      .filter((sub) => sub && sub.length >= 4 && !topicLooseMatch(sub, themeLabel))
      .slice(0, 5)
      .map((sub) => ({
        label: sub,
        role: isGerman ? 'Unterthema' : 'Subtopic',
        parent: themeLabel,
        why: mkWhy(sub, isGerman ? 'Unterthema' : 'Subtopic', themeLabel)
      }));
    sections.push({
      label: themeLabel,
      role: themeRole,
      parent: '',
      why: mkWhy(themeLabel, themeRole, ''),
      subtopics
    });
  }

  if (!sections.length && focusTheme) {
    const fl = polishDeepDiveLabel(focusTheme, language);
    sections.push({
      label: fl,
      role: isGerman ? 'Fokusthema' : 'Focus theme',
      parent: '',
      why: mkWhy(fl, isGerman ? 'Fokusthema' : 'Focus theme', ''),
      subtopics: []
    });
  }

  return sections;
}

function flattenDeepDiveSections(sections = []) {
  const flat = [];
  for (const section of sections) {
    flat.push({
      label: section.label,
      role: section.role,
      parent: '',
      why: section.why
    });
    for (const sub of section.subtopics || []) {
      flat.push({
        label: sub.label,
        role: sub.role,
        parent: sub.parent || section.label,
        why: sub.why
      });
    }
  }
  return flat;
}

function makeDeepDiveTopics(opts) {
  return flattenDeepDiveSections(buildDeepDiveSections(opts));
}

function inferLectureOrderIndex(folder = '', meta = {}) {
  const haystack = [
    folder,
    meta.sourceFile,
    meta.sourceTitleFromFile,
    meta.inferredLectureName
  ].filter(Boolean).join(' ');
  const patterns = [
    /\b(?:vl|vorlesung|vorl|lec|lecture|session|unit|kapitel|kap|woche|week|stunde|teil)\s*[-_.#]?\s*0*(\d{1,2})\b/i,
    /\b0*(\d{1,2})\s*[-_.]\s*(?:vl|vorlesung|lec|lecture)\b/i,
    /^0*(\d{1,2})[_\s-]/i,
    /[_\s-]0*(\d{1,2})(?:[_\s.-]|$)/i,
    /\b(?:^|[^0-9])0*(\d{1,2})(?:[^0-9]|$)\b/
  ];
  for (const re of patterns) {
    const m = haystack.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= 99) return n;
    }
  }
  return null;
}

function enrichCourseLectureRows(courseName, rows = []) {
  const language = rows[0]?.outputLanguage || 'German';
  const isGerman = language === 'German';
  const sorted = [...rows].sort((a, b) => {
    const ai = inferLectureOrderIndex(a.id, a.meta) ?? 999;
    const bi = inferLectureOrderIndex(b.id, b.meta) ?? 999;
    if (ai !== bi) return ai - bi;
    return new Date(a.processedAt || 0) - new Date(b.processedAt || 0);
  });
  return sorted.map((row, idx, arr) => {
    const index = idx + 1;
    const total = arr.length;
    const prev = idx > 0 ? arr[idx - 1] : null;
    const next = idx < arr.length - 1 ? arr[idx + 1] : null;
    const label = isGerman ? `Vorlesung ${index}` : `Lecture ${index}`;
    return {
      ...row,
      sequenceIndex: index,
      sequenceTotal: total,
      sequenceLabel: label,
      sequenceHint: inferLectureOrderIndex(row.id, row.meta) ? `${label} (Nr. ${inferLectureOrderIndex(row.id, row.meta)})` : label,
      previousLecture: prev ? { id: prev.id, name: prev.name, path: prev.path, sequenceIndex: prev.sequenceIndex } : null,
      nextLecture: next ? { id: next.id, name: next.name, path: next.path, sequenceIndex: next.sequenceIndex } : null,
      buildsOn: prev
        ? (isGerman ? `Baut auf ${prev.sequenceLabel || prev.name} auf` : `Builds on ${prev.sequenceLabel || prev.name}`)
        : (isGerman ? 'Einstieg in den Kurs' : 'Course entry point')
    };
  });
}

function buildCourseSequenceEntry(courseName, lecturePath, meta = {}) {
  const enriched = getEnrichedCourseRows(courseName);
  const current = enriched.find((r) => r.path === lecturePath);
  if (!current) {
    return {
      index: 1,
      total: enriched.length || 1,
      label: meta.outputLanguage === 'German' ? 'Vorlesung 1' : 'Lecture 1',
      buildsOn: null,
      previousName: null,
      nextName: null
    };
  }
  return {
    index: current.sequenceIndex,
    total: current.sequenceTotal,
    label: current.sequenceLabel,
    hint: current.sequenceHint,
    buildsOn: current.buildsOn,
    previousName: current.previousLecture?.name || null,
    previousPath: current.previousLecture?.path || null,
    previousId: current.previousLecture?.id || null,
    nextName: current.nextLecture?.name || null,
    nextPath: current.nextLecture?.path || null,
    nextId: current.nextLecture?.id || null,
    arc: enriched.map((r) => ({
      index: r.sequenceIndex,
      name: r.name,
      id: r.id,
      path: r.path,
      active: r.path === lecturePath,
      buildsOn: r.buildsOn
    }))
  };
}

function getCourseLectureRowsRaw(courseName) {
  const vaultPath = store.get('vaultPath');
  if (!vaultPath || !courseName) return [];
  const courseDir = path.join(vaultPath, sanitizeName(courseName));
  if (!fs.existsSync(courseDir)) return [];
  return fs.readdirSync(courseDir)
    .filter((folder) => fs.statSync(path.join(courseDir, folder)).isDirectory())
    .map((folder) => {
      const lecturePath = path.join(courseDir, folder);
      const meta = safeJson(path.join(lecturePath, 'meta.json')) || {};
      const displayName = resolveLectureDisplayName(meta, safeJson(path.join(lecturePath, 'lecture_structure.json')), folder, courseName);
      return {
        id: folder,
        path: lecturePath,
        name: displayName,
        meta: { ...meta, inferredLectureName: displayName },
        processedAt: meta.processedAt || '',
        outputLanguage: meta.outputLanguage
      };
    });
}

function polishDeepDiveLabel(label, language = 'German') {
  let text = String(label || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+-\s+/g, ' - ')
    .replace(/\b([A-ZÄÖÜ]{2,})\s+-\s+/g, '$1-')
    .replace(/\s*[:;,.]$/g, '')
    .trim();
  if (language === 'German') {
    text = text
      .replace(/^Informationsverarbeitung$/i, 'Informationsverarbeitung und Gestaltung')
      .replace(/^a\.V\.\(abhängige Variable\)$/i, 'Abhängige Variable')
      .replace(/^Antialiasing Methoden -Subpixel-Rendering$/i, 'Antialiasing und Subpixel-Rendering');
  }
  return text;
}

function buildDeepDiveReason({ label, role, parent, recurrence, prerequisites, language }) {
  const isGerman = language === 'German';
  if (recurrence?.hits?.length) {
    const hit = recurrence.hits[0];
    return isGerman
      ? `Wiederkehrendes Thema: ${hit.relation} in ${hit.lectureName}.`
      : `Recurring theme: ${hit.relation} in ${hit.lectureName}.`;
  }
  if (parent) return isGerman ? `Unterthema zu ${parent}; gut geeignet zum gezielten Vertiefen.` : `Subtopic under ${parent}; useful for focused study.`;
  if (/Fokusthema|Focus theme/.test(role)) return isGerman ? 'Zentrum der Vorlesung; hier lohnt sich der erste Deep Dive.' : 'Center of the lecture; the best first deep dive.';
  if (prerequisites?.length) return isGerman ? `Wichtiges Konzept; zuerst prüfen: ${prerequisites[0]}.` : `Important concept; review first: ${prerequisites[0]}.`;
  return isGerman ? 'Zentrales Konzept der Vorlesung.' : 'Central concept in this lecture.';
}

function extractStructuredHeadings(text = '') {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const clean = line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^[-*•]\s+/, '')
      .replace(/^\d{1,2}[.)]\s+/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (clean.length < 5 || clean.length > 90) continue;
    const looksHeading = /^#{1,6}\s+/.test(line) || /^\d{1,2}[.)]\s+[A-ZÄÖÜ]/.test(line) || /^[A-ZÄÖÜ][^.!?]{4,90}$/.test(clean);
    if (looksHeading && !/^(page|seite|agenda|outline|contents?|references|literatur|bibliography)$/i.test(clean)) out.push(clean);
    if (out.length >= 24) break;
  }
  return out;
}

function extractBoldTerms(text = '') {
  const out = [];
  for (const match of String(text || '').matchAll(/\*\*(.+?)\*\*/g)) {
    const term = match[1].trim();
    if (term.length >= 4 && term.length <= 80) out.push(term);
  }
  return out;
}

function cleanLectureTitle(value = '', language = 'German', courseTerms = new Set()) {
  let title = String(value || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/\b[A-ZÄÖÜ]{1,6}\s*[-_]?\s*(19|20)\d{2}\s*[-_]?\s*\d{1,2}\b/g, '')
    .replace(/\b[A-ZÄÖÜ]{1,6}\s*[-_]?\s*\d{1,2}\b/g, '')
    .replace(/\b(19|20)\d{2}\b/g, '')
    .replace(/\b(vl|lecture|lec|vorlesung|session|stunde)\b\s*\d{0,2}/ig, '')
    .replace(/^\d{1,2}\s*[-:.]?\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!title || title.length < 5) {
    const parts = String(value || '').replace(/\.[a-z0-9]+$/i, '').split(/[-_]/).map(x => x.trim()).filter(Boolean);
    title = parts[parts.length - 1] || title;
  }
  title = cleanTopicLabel(title, language, courseTerms);
  if (!title || isBadTopicLabel(title, { raw: title, source: 'title', language })) return '';
  return title;
}

function cleanTopicLabel(value, language = 'German', courseTerms = new Set()) {
  let label = String(value || '')
    .replace(/\u00ad/g, '')
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/^#+\s*/, '')
    .replace(/^[-*•\d.)\s]+/, '')
    .replace(/\*+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/([a-zäöüß])([A-ZÄÖÜ])/g, '$1 $2')
    .replace(/([a-zäöüß])([A-ZÄÖÜ])/g, '$1 $2')
    .replace(/([A-Za-zÄÖÜäöüß])\/(\w)/g, '$1 / $2')
    .replace(/\s*[-:]\s*$/g, '')
    .trim();
  label = label.replace(/^(definition|concept|topic|theme|section|chapter|kapitel|abschnitt|thema|begriff|inhalt|inhalte)\s*[:\-]\s*/i, '');
  label = label.replace(/\b(for)([A-Z])/g, '$1 $2').replace(/\b(of)([A-Z])/g, '$1 $2').replace(/\b(and)([A-Z])/g, '$1 $2');
  if (language === 'German') {
    label = label
      .replace(/^focus theme$/i, 'Fokusthema')
      .replace(/^core themes?$/i, 'Kernthemen')
      .replace(/^subtopics?( & navigation)?$/i, 'Unterthemen')
      .replace(/^lecture structure$/i, 'Aufbau der Vorlesung')
      .replace(/^central vs supporting$/i, 'Zentral vs. unterstützend')
      .replace(/^prerequisites? & continuation$/i, 'Voraussetzungen und Anschluss');
  }
  const canonical = topicCanonicalKey(label);
  if (courseTerms.has(canonical)) return '';
  return label;
}

function buildCourseTermSet(courseName = '', meta = {}) {
  const raw = [courseName, meta.course]
    .filter(Boolean)
    .flatMap(v => String(v).replace(/\.[a-z0-9]+$/i, '').split(/[-_/|]+/));
  return new Set(raw.map(topicCanonicalKey).filter(x => x.length >= 4));
}

function topicCanonicalKey(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9äöüß]+/g, ' ')
    .replace(/\b(der|die|das|und|oder|mit|von|zur|zum|the|and|of|for|in|to|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNearCourseMetadata(label, courseName = '', meta = {}) {
  const key = topicCanonicalKey(label);
  if (!key) return true;
  const courseKey = topicCanonicalKey(courseName || meta.course || '');
  const titleKey = topicCanonicalKey(meta.inferredLectureName || '');
  if (key === courseKey) return true;
  if (key.length < 5) return true;
  if (courseKey && key === courseKey) return true;
  if (/^(sose|wise|ws|ss|sommersemester|wintersemester)\s*\d{4}$/.test(key)) return true;
  if (/^\d{4}$/.test(key)) return true;
  if (titleKey && key === titleKey && key.split(' ').length <= 2 && courseKey.includes(key)) return true;
  return false;
}

function scoreTopicCandidate(label, ctx = {}) {
  if (isBadTopicLabel(label, ctx)) return -100;
  const key = topicCanonicalKey(label);
  const words = key.split(' ').filter(Boolean);
  let score = 0;
  if (words.length === 1) score += 1.2;
  if (words.length >= 2 && words.length <= 5) score += 2.8;
  if (words.length > 5) score -= (words.length - 5) * 1.2;
  if (/[äöüß]/i.test(label)) score += ctx.language === 'German' ? 0.8 : 0;
  if (/\b(anova|varianzanalyse|varianz|faktor|faktorstufe|quadratsumme|mittelwert|effekt|f-test|messwiederholung|codierung|wahrnehmung|typografie|farben|kommunikation|sensorik|vektor|raster|regression|hypothese|inferenz|stichprobe|funktion|relation|menge)\b/i.test(label)) score += 2.2;
  if (ctx.source === 'title') score += 1.8;
  if (ctx.source === 'agenda') score += 1.6;
  if (ctx.source === 'definition-table') score += 1.9;
  if (ctx.source === 'concepts-bold') score += 1.4;
  if (ctx.source === 'legacy-hint') score -= 1.4;
  const rawText = `${ctx.extracted || ''}\n${ctx.raw || ''}`.toLowerCase();
  const occurrences = countOccurrences(rawText, key);
  if (occurrences >= 2) score += Math.min(2, occurrences * 0.35);
  if (/^[A-ZÄÖÜ][a-zäöüß]+(\s+[A-ZÄÖÜ][a-zäöüß]+){1,3}$/.test(label) && !/[äöüß]/i.test(label) && ctx.language === 'German') score -= 2.5;
  return score;
}

function isBadTopicLabel(label, ctx = {}) {
  const raw = String(ctx.raw || label || '').trim();
  const text = String(label || '').trim();
  const lower = text.toLowerCase();
  const key = topicCanonicalKey(text);
  if (!text || text.length < 3 || text.length > 72) return true;
  if (isNearCourseMetadata(text, ctx.courseName, ctx.meta)) return true;
  if (/https?:|www\.|@|\.de\b|\.com\b|moodle|email|e-mail/i.test(raw)) return true;
  if (/\b(university|universität|duisburg|essen|faculty|fakultät|department|professor|prof\.?|dr\.?|m\.sc|b\.sc|computing group|human-centered|cognitive science|lehrstuhl|institut|campus)\b/i.test(raw)) return true;
  if (/\b(sose|wise|sommersemester|wintersemester|semester|woche\s*inhalte|vorlesungsinhalte|organisatorisches|einleitung|kommunikationskanäle|übungsgruppen|übungsbeginn|moodle|tutor:innen|tauschbörse|abgabe|copyright|seite|page)\b/i.test(raw)) return true;
  if (/^[\d\s|./:-]+$/.test(text)) return true;
  if (/^\d+\s*[|/]\s*/.test(raw)) return true;
  if (/\b\d{1,2}\.\d{1,2}\.\s*\d{4}\b/.test(raw)) return true;
  if ((raw.match(/[A-ZÄÖÜ][a-zäöüß]+[A-ZÄÖÜ][a-zäöüß]+/g) || []).length >= 3) return true;
  if (/[a-zäöüß]{18,}[A-ZÄÖÜ]/.test(raw)) return true;
  if (/^(wie|das|die|der|durchschnittliche|unterschiedliche|was|wozu|warum|übersehen|verstehen|beachten)\b/i.test(text)) return true;
  if (/\b(eines|einer|einem|einen|vom|von|zur|zum|mit|durch|dieser|diesen|dieses|voraus|beim|bei|für|als)$/i.test(text)) return true;
  if (/[a-zäöüß]{10,}(dieser|diese|dieses|denen|keit|ungen)/i.test(text) && !/[ -]/.test(text)) return true;
  if (/\b(auf der|auf dem|auf den|x-achse|y-achse)\b/i.test(text)) return true;
  if (/^(original|beispiel|abbildung|grafik|folie|teil|kapitel)$/i.test(text)) return true;
  if (/\b(wird|werden|wurde|sollten|soll|kann|können|durch|steckt|beeinflusst|geteilt|abweicht|voraus|beispiel)\b/i.test(text) && key.split(' ').length > 2) return true;
  if (key.split(' ').length > 6) return true;
  if (/^(übersicht|agenda|literatur|references|table contents|zusammenfassung|lernziele|inhalt|inhalte|original|beispiel|abbildung|folie)$/.test(key)) return true;
  if (ctx.language === 'German' && /\b(faculty|department|university|professor|lecture|course|contents|overview|chapter|section)\b/i.test(text)) return true;
  return false;
}

function countOccurrences(haystack = '', needleKey = '') {
  if (!needleKey || needleKey.length < 4) return 0;
  const normalized = topicCanonicalKey(haystack);
  const escaped = needleKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (normalized.match(new RegExp(`\\b${escaped}\\b`, 'g')) || []).length;
}

function extractAgendaTopics(text = '', lectureTitle = '') {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
  const out = [];
  const titleKey = topicCanonicalKey(lectureTitle);
  let start = 0;
  if (titleKey) {
    const hits = [];
    for (let i = 0; i < Math.min(lines.length, 220); i++) {
      const key = topicCanonicalKey(lines[i]);
      if (key.includes(titleKey) || titleKey.includes(key)) hits.push(i);
    }
    if (hits.length) start = Math.min(lines.length - 1, hits[hits.length - 1] + 1);
  }
  for (let i = start; i < Math.min(lines.length, start + 180); i++) {
    const original = lines[i];
    if (/übersicht über die vorlesungsinhalte|woche\s*inhalte|organisatorisches|kommunikationskanäle|übungsgruppen|moodle/i.test(original)) continue;
    let line = original
      .replace(/^\d+\s*\|.*$/g, '')
      .replace(/^\d{1,2}\s*[-–—]?\s*/, '')
      .replace(/^(\d{1,2})\s*([A-ZÄÖÜ].*)$/, '$2')
      .replace(/^\d{1,2}[.)]\s*/, '')
      .trim();
    const originalLooksNumbered = /^\d{1,2}[.)]\s*[A-ZÄÖÜ]/.test(original);
    const isShortHeading = /^[A-ZÄÖÜ][A-Za-zÄÖÜäöüß\- ]{6,58}$/.test(line) && line.split(/\s+/).length <= 5;
    if (originalLooksNumbered || isShortHeading) out.push(line);
    if (out.length >= 14) break;
  }
  return out;
}

function extractDefinitionTableTerms(text = '') {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
  const terms = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+/g, ' ').trim();
    if (/^(begriff|term|bedeutung|erklärung|merkhilfe|analogie)$/i.test(line)) continue;
    const wordCount = line.split(/\s+/).length;
    const looksTerm = /^[A-Za-zÄÖÜäöüßηω²/.() -]{3,34}$/.test(line) && wordCount <= 4;
    const nextDefines = i + 1 < lines.length && /\b(abhängige|unabhängige|variable|ausprägung|abweichung|gesamtstreuung|signifikanz|faktor|effekt|varianz|prüft|gemessen|defined|variance|factor|effect)\b/i.test(lines[i + 1]);
    if (looksTerm && nextDefines && !/^(wie|das|die|der|durchschnittliche|unterschiedliche|was|begriff|bedeutung)/i.test(line)) terms.push(line);
    if (terms.length >= 12) break;
  }
  return terms;
}

function extractConceptualBullets(text = '') {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const m = line.match(/^[•*-]\s*(.{5,90})$/) || line.match(/^\d+[.)]\s*(.{5,90})$/);
    if (!m) continue;
    const candidate = m[1].split(/[=:–—-]/)[0].trim();
    if (candidate.length >= 5 && candidate.length <= 60) out.push(candidate);
    if (out.length >= 18) break;
  }
  return out;
}

function dedupeTopicCandidates(candidates = []) {
  const out = [];
  for (const cand of candidates) {
    if (!out.some(x => topicLooseMatch(x.label, cand.label) || topicCanonicalKey(x.label) === topicCanonicalKey(cand.label))) out.push(cand);
  }
  return out;
}

function dedupeTopicLabels(labels = []) {
  return dedupeTopicCandidates(labels.filter(Boolean).map(label => ({ label, score: 0 }))).map(x => x.label);
}

function topicBelongsUnder(label, theme) {
  const a = topicCanonicalKey(label);
  const b = topicCanonicalKey(theme);
  if (!a || !b || a === b) return false;
  return a.includes(b) || b.includes(a) || titleMatchScore(label, theme) > 0.25;
}

function uniqueTopicObjects(items = []) {
  const out = [];
  for (const item of items) {
    if (!item?.label) continue;
    if (!out.some((x) => x.label.toLowerCase() === item.label.toLowerCase() || titleMatchScore(x.label, item.label) > 0.78)) out.push(item);
  }
  return out;
}

function topicLooseMatch(a = '', b = '') {
  return titleMatchScore(a, b) > 0.34 || String(a).toLowerCase().includes(String(b).toLowerCase()) || String(b).toLowerCase().includes(String(a).toLowerCase());
}

function findRecurringThemesForLecture(courseName, lecturePath, topics = [], language = 'German', currentLectureName = '') {
  const rows = getCourseLectureRowsLite(courseName, lecturePath);
  const out = [];
  for (const topic of topics.slice(0, 12)) {
    const hits = [];
    for (const row of rows) {
      if (row.path === lecturePath) continue;
      if (currentLectureName && topicLooseMatch(row.name, currentLectureName)) continue;
      const score = titleMatchScore(row.searchText, topic.toLowerCase());
      if (score > 0.05 || row.searchText.includes(String(topic).toLowerCase())) hits.push({ lectureId: row.id, lecturePath: row.path, lectureName: row.name, relation: row.isBefore ? (language === 'German' ? 'früher eingeführt' : 'introduced earlier') : (language === 'German' ? 'kommt später wieder' : 'returns later') });
    }
    if (hits.length) out.push({ label: topic, hits: hits.slice(0, 4) });
  }
  return out.slice(0, 8);
}

function getCourseLectureRowsLite(courseName, currentPath = '') {
  const rows = getEnrichedCourseRows(courseName);
  const currentIdx = rows.findIndex((r) => r.path === currentPath);
  return rows.map((row, idx) => {
    const lecturePath = row.path;
    const meta = row.meta || {};
    const body = `${row.name}
${(meta.topicHints || []).join(' ')}
${safeRead(path.join(lecturePath, 'overview.md')).slice(0, 8000)}
${safeRead(path.join(lecturePath, 'concepts.md')).slice(0, 8000)}`;
    return {
      id: row.id,
      path: lecturePath,
      name: row.name,
      sequenceIndex: row.sequenceIndex,
      isBefore: currentIdx >= 0 ? idx < currentIdx : false,
      isAfter: currentIdx >= 0 ? idx > currentIdx : false,
      searchText: body.toLowerCase()
    };
  });
}

function buildPrerequisiteModel(courseName, lecturePath, topics = [], meta = {}, language = 'German') {
  const seq = buildCourseSequenceEntry(courseName || meta.course || '', lecturePath, meta);
  const rows = getCourseLectureRowsLite(courseName || meta.course || '', lecturePath);
  const idx = rows.findIndex((row) => row.path === lecturePath);
  const previous = idx > 0 ? rows[idx - 1] : null;
  const out = [];
  if (seq.index > 1 && previous) {
    out.push(language === 'German'
      ? `${seq.label}: baut auf ${previous.name} auf — zuerst Vorlesung ${previous.sequenceIndex || idx} sichern`
      : `${seq.label}: builds on ${previous.name} — secure lecture ${previous.sequenceIndex || idx} first`);
  }
  if (previous) out.push(language === 'German' ? `Vorher wiederholen: ${previous.name}` : `Review first: ${previous.name}`);
  const prevStructure = previous ? safeJson(path.join(previous.path, 'lecture_structure.json')) : null;
  const prevFocus = prevStructure?.focusTheme || previous?.name;
  if (prevFocus && !isOrganizationalLectureTitle(prevFocus)) {
    out.push(language === 'German' ? `Grundlage: ${prevFocus}` : `Foundation: ${prevFocus}`);
  }
  for (const topic of topics.slice(0, 3)) out.push(language === 'German' ? `In dieser Vorlesung: ${topic}` : `In this lecture: ${topic}`);
  return [...new Set(out)].slice(0, 7);
}

function formatLectureStructureForPrompt(structure = {}) {
  if (!structure) return '';
  const seq = structure.courseSequence || {};
  const lines = [
    seq.label ? `Course position: ${seq.label} of ${seq.total || '?'}` : '',
    seq.buildsOn ? `Builds on: ${seq.buildsOn}` : '',
    seq.previousName ? `Previous lecture: ${seq.previousName}` : '',
    `Focus theme: ${structure.focusTheme || ''}`,
    `Core themes: ${(structure.coreThemes || []).join('; ')}`,
    `Prerequisites: ${(structure.prerequisites || []).join('; ')}`,
    `Recurring themes: ${(structure.recurringThemes || []).map(r => `${r.label} (${(r.hits || []).map(h => h.lectureName).join(', ')})`).join('; ')}`,
    'Topic tree:',
    ...((structure.topicTree || []).map(theme => `- ${theme.label}: ${(theme.subtopics || []).join('; ')}`))
  ];
  return lines.filter(Boolean).join('\n');
}

function loadNoteCards(lecturePath) {
  return safeJson(path.join(lecturePath, 'note_cards.json')) || { cards: [] };
}

function saveNoteCardsFile(lecturePath, data) {
  fs.writeFileSync(path.join(lecturePath, 'note_cards.json'), JSON.stringify(data, null, 2), 'utf8');
}

function ensureDeepStudy(meta = {}) {
  if (!meta.deepStudy || typeof meta.deepStudy !== 'object') {
    meta.deepStudy = {
      explored: [],
      askLog: [],
      complete: false,
      completeAt: null,
      completeReason: '',
      lastSuggestions: []
    };
  }
  if (!Array.isArray(meta.deepStudy.explored)) meta.deepStudy.explored = [];
  if (!Array.isArray(meta.deepStudy.askLog)) meta.deepStudy.askLog = [];
  return meta.deepStudy;
}

function exploreKey(topic = '', subtopic = '') {
  return `${topicCanonicalKey(topic)}::${topicCanonicalKey(subtopic || '')}`;
}

function collectNavigableTopicLabels(structure = {}) {
  const out = [];
  const sections = structure.deepDiveSections?.length
    ? structure.deepDiveSections
    : (structure.topicTree || []).map((t) => ({
      label: t.label,
      subtopics: (t.subtopics || []).map((s) => (typeof s === 'string' ? { label: s } : s))
    }));
  for (const sec of sections) {
    if (sec?.label) out.push({ label: sec.label, parent: '', kind: 'theme' });
    for (const sub of sec.subtopics || []) {
      const label = typeof sub === 'string' ? sub : sub.label;
      if (label) out.push({ label, parent: sec.label, kind: 'subtopic' });
    }
  }
  return out;
}

function computeDeepStudyCoverage(structure = {}, deepStudy = {}) {
  const all = collectNavigableTopicLabels(structure);
  const themes = all.filter((t) => t.kind === 'theme');
  const subs = all.filter((t) => t.kind === 'subtopic');
  const exploredKeys = new Set((deepStudy.explored || []).map((e) => exploreKey(e.topic, e.subtopic)));
  let coveredThemes = 0;
  for (const th of themes) {
    if (exploredKeys.has(exploreKey(th.label, ''))) coveredThemes += 1;
  }
  let coveredSubs = 0;
  for (const st of subs) {
    if (exploredKeys.has(exploreKey(st.label, '')) || exploredKeys.has(exploreKey(st.parent, st.label))) {
      coveredSubs += 1;
    }
  }
  const themeRatio = themes.length ? coveredThemes / themes.length : 0;
  const subRatio = subs.length ? coveredSubs / Math.max(subs.length, 1) : 1;
  const ratio = subs.length >= 3 ? themeRatio * 0.4 + subRatio * 0.6 : themeRatio;
  const complete = ratio >= 0.82
    && (deepStudy.explored || []).length >= Math.max(2, Math.min(themes.length, 4))
    && (deepStudy.askLog || []).length >= 1;
  return {
    themesTotal: themes.length,
    themesCovered: coveredThemes,
    subtopicsTotal: subs.length,
    subtopicsCovered: coveredSubs,
    exploredCount: (deepStudy.explored || []).length,
    questionsCount: (deepStudy.askLog || []).length,
    ratio,
    complete
  };
}

function recordDeepStudyExplore(lecturePath, entry = {}) {
  return updateLectureMeta(lecturePath, (meta) => {
    const ds = ensureDeepStudy(meta);
    const key = exploreKey(entry.topic, entry.subtopic);
    const exists = ds.explored.some((e) => exploreKey(e.topic, e.subtopic) === key);
    if (!exists) {
      ds.explored.push({
        topic: entry.topic || '',
        subtopic: entry.subtopic || '',
        parentTopic: entry.parentTopic || '',
        mode: entry.mode || 'explain',
        slug: entry.slug || '',
        at: new Date().toISOString()
      });
      ds.explored = ds.explored.slice(-40);
    }
    if (ds.complete && !computeDeepStudyCoverage(
      safeJson(path.join(lecturePath, 'lecture_structure.json')) || {},
      ds
    ).complete) {
      ds.complete = false;
      ds.completeAt = null;
      ds.completeReason = '';
    }
    meta.deepStudy = ds;
    return meta;
  });
}

function recordDeepStudyQuestion(lecturePath, question = '', activeTab = '') {
  return updateLectureMeta(lecturePath, (meta) => {
    const ds = ensureDeepStudy(meta);
    ds.askLog.push({
      question: String(question).trim().slice(0, 500),
      tab: activeTab || '',
      at: new Date().toISOString()
    });
    ds.askLog = ds.askLog.slice(-30);
    meta.deepStudy = ds;
    return meta;
  });
}

function persistDeepSuggestions(lecturePath, suggestions, complete, completeMessage) {
  return updateLectureMeta(lecturePath, (meta) => {
    const ds = ensureDeepStudy(meta);
    ds.lastSuggestions = suggestions;
    if (complete) {
      ds.complete = true;
      ds.completeAt = new Date().toISOString();
      ds.completeReason = completeMessage || ds.completeReason;
    }
    meta.deepStudy = ds;
    return meta;
  });
}

function buildHeuristicDeepSuggestions(structure, deepStudy, ctx = {}) {
  const { parentTopic, currentTopic, currentSubtopic, isGerman } = ctx;
  const explored = new Set((deepStudy.explored || []).map((e) => exploreKey(e.topic, e.subtopic)));
  const out = [];
  for (const item of collectNavigableTopicLabels(structure)) {
    const key = exploreKey(item.kind === 'subtopic' ? item.label : item.label, item.kind === 'subtopic' ? item.parent : '');
    const altKey = exploreKey(item.label, '');
    if (explored.has(key) || explored.has(altKey)) continue;
    if (currentSubtopic && topicLooseMatch(item.label, currentSubtopic)) continue;
    out.push({
      label: item.label,
      reason: isGerman
        ? (item.kind === 'subtopic' ? `Vertieft „${parentTopic || currentTopic}“ weiter.` : 'Noch nicht bearbeitet.')
        : (item.kind === 'subtopic' ? `Continue "${parentTopic || currentTopic}".` : 'Not explored yet.')
    });
    if (out.length >= 4) break;
  }
  return out;
}

function buildDeepStepSuggestionPrompt(language, profile = 'conceptual') {
  const isGerman = language === 'German';
  return `You are StudyAI's deep-study coach. Write in ${language}. Return strict JSON only.

Schema:
{
  "complete": false,
  "completeMessage": "only if complete is true — short congrats",
  "suggestions": [
    { "label": "next subtopic or angle label from lecture", "reason": "one sentence why now (gap, mistake, link to last dive or question)" }
  ]
}

Rules:
- Suggest 0–4 NEXT steps the student should deep-dive; labels must exist in allTopics or be tight children of currentTopic.
- Use explored list and student questions to avoid repeats; prioritize gaps and confusion.
- If coverage is strong (most themes/subtopics explored) AND questions show understanding, set complete true.
- Profile: ${profile}. ${profile === 'programming' ? 'Prefer next code concepts, bugs, or trace tasks.' : ''}
- Labels in ${language}.`;
}

function updateLectureMeta(lecturePath, mutate) {
  const metaPath = path.join(lecturePath, 'meta.json');
  const meta = safeJson(metaPath) || {};
  const next = mutate({ ...meta }) || meta;
  next.progress = next.plannerStatus === 'done' ? 'done' : inferProgress(next);
  fs.writeFileSync(metaPath, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function getCourseLectureRows(courseName) {
  const enriched = getEnrichedCourseRows(courseName);
  return enriched.map((row) => {
    const lecturePath = row.path;
    const meta = row.meta || {};
    const overview = safeRead(path.join(lecturePath, 'overview.md'));
    const concepts = safeRead(path.join(lecturePath, 'concepts.md'));
    const summary = safeRead(path.join(lecturePath, 'summary.md'));
    const body = `${overview}\n${concepts}\n${summary}`;
    const lectureStructure = safeJson(path.join(lecturePath, 'lecture_structure.json')) || {
      focusTheme: meta.focusTheme || '',
      coreThemes: meta.coreThemes || [],
      navigableTopics: Array.isArray(meta.topicHints) ? meta.topicHints.map((label) => ({ label })) : [],
      prerequisites: Array.isArray(meta.prerequisites) ? meta.prerequisites : []
    };
    return {
      ...row,
      processedAt: meta.processedAt || '',
      topicHints: lectureStructure?.navigableTopics?.map((t) => t.label).slice(0, 8) || (Array.isArray(meta.topicHints) ? meta.topicHints.slice(0, 8) : extractTopicHints(body).slice(0, 8)),
      focusTheme: lectureStructure?.focusTheme || meta.focusTheme || '',
      coreThemes: lectureStructure?.coreThemes || meta.coreThemes || [],
      prerequisites: lectureStructure?.prerequisites || (Array.isArray(meta.prerequisites) ? meta.prerequisites : []),
      progress: meta.plannerStatus === 'done' ? 'done' : inferProgress(meta)
    };
  });
}

function getLecturePrerequisites(lecturePath) {
  const meta = safeJson(path.join(lecturePath, 'meta.json')) || {};
  if (Array.isArray(meta.prerequisites) && meta.prerequisites.length) return meta.prerequisites;
  const courseName = meta.course || '';
  const rows = getCourseLectureRows(courseName);
  const idx = rows.findIndex((row) => row.path === lecturePath);
  const previous = idx > 0 ? rows[idx - 1] : null;
  const ownTopics = Array.isArray(meta.topicHints) ? meta.topicHints : [];
  const prereqs = [];
  if (previous) prereqs.push(`Review previous lecture: ${previous.name}`);
  for (const topic of (previous?.topicHints || []).slice(0, 3)) prereqs.push(`Bring forward: ${topic}`);
  for (const topic of ownTopics.slice(0, 2)) prereqs.push(`Be ready to define: ${topic}`);
  return [...new Set(prereqs)].slice(0, 6);
}

function buildLectureThreadContext(courseName, lecturePath) {
  const rows = getCourseLectureRows(courseName);
  const idx = rows.findIndex((row) => row.path === lecturePath);
  const current = idx >= 0 ? rows[idx] : null;
  const prev = idx > 0 ? rows[idx - 1] : null;
  const next = idx >= 0 && idx < rows.length - 1 ? rows[idx + 1] : null;
  const topics = current?.topicHints || [];
  const prerequisites = current ? getLecturePrerequisites(current.path) : [];
  const threadName = inferThreadName(topics, current?.name || 'Current lecture');
  const seq = buildCourseSequenceEntry(courseName, lecturePath, safeJson(path.join(lecturePath, 'meta.json')) || {});
  const isGerman = (safeJson(path.join(lecturePath, 'lecture_structure.json'))?.language || '') === 'German';
  const summary = idx >= 0
    ? (isGerman
      ? `${seq.label}: ${current?.buildsOn || 'Teil der Kurslogik'}.`
      : `${seq.label}: ${current?.buildsOn || 'Part of the course arc'}.`)
    : '';
  return {
    threadName,
    position: idx >= 0 ? `${idx + 1}/${rows.length}` : '',
    sequenceLabel: seq.label,
    sequenceIndex: seq.index,
    sequenceTotal: seq.total,
    buildsOn: current?.buildsOn || seq.buildsOn,
    summary,
    previousLecture: prev ? { id: prev.id, name: prev.name, path: prev.path, sequenceLabel: prev.sequenceLabel, progress: prev.progress, topicHints: prev.topicHints?.slice(0, 4) || [] } : null,
    nextLecture: next ? { id: next.id, name: next.name, path: next.path, sequenceLabel: next.sequenceLabel, progress: next.progress, topicHints: next.topicHints?.slice(0, 4) || [] } : null,
    prerequisites,
    currentTopics: topics.slice(0, 6),
    courseArc: rows.map((row) => ({
      id: row.id,
      name: row.name,
      path: row.path,
      active: row.path === lecturePath,
      index: row.sequenceIndex,
      label: row.sequenceLabel,
      progress: row.progress,
      buildsOn: row.buildsOn
    }))
  };
}

function buildLectureThreadContextFromMaterials(lecturePath, materials = {}) {
  const meta = safeJson(path.join(lecturePath, 'meta.json')) || {};
  const ctx = buildLectureThreadContext(meta.course || '', lecturePath);
  const localTopics = materials.lectureStructure?.navigableTopics?.map(t => t.label).slice(0, 8) || (Array.isArray(meta.topicHints) && meta.topicHints.length
    ? meta.topicHints
    : extractTopicHints(`${materials.overview || ''}
${materials.concepts || ''}
${materials.summary || ''}`).slice(0, 8));
  const lines = [
    `Course thread: ${ctx.threadName || inferThreadName(localTopics, meta.inferredLectureName || '')}`,
    ctx.sequenceLabel ? `Course position: ${ctx.sequenceLabel} (${ctx.position})` : (ctx.position ? `Lecture position: ${ctx.position}` : ''),
    ctx.buildsOn ? `Progression: ${ctx.buildsOn}` : '',
    ctx.previousLecture ? `Previous: ${ctx.previousLecture.sequenceLabel || ''} — ${ctx.previousLecture.name}` : '',
    ctx.nextLecture ? `Next: ${ctx.nextLecture.sequenceLabel || ''} — ${ctx.nextLecture.name}` : '',
    ctx.prerequisites?.length ? `Prerequisites: ${ctx.prerequisites.join('; ')}` : '',
    localTopics.length ? `Current topic anchors: ${localTopics.slice(0, 6).join('; ')}` : ''
  ].filter(Boolean);
  return { ...ctx, markdown: lines.join('\n') };
}

function inferThreadName(topicHints = [], fallback = '') {
  const topic = topicHints.find((t) => String(t).length >= 5) || fallback || 'Course progression';
  return String(topic).replace(/^#+\s*/, '').slice(0, 70);
}

function buildThreadHighlights(world) {
  const highlights = [];
  for (const course of world.courses || []) {
    const open = course.lectures.filter((l) => l.progress !== 'done');
    const current = open[0] || course.lectures[0];
    if (!current) continue;
    const ctx = buildLectureThreadContext(course.name, current.path);
    highlights.push({
      courseId: course.id,
      courseName: course.name,
      lectureId: current.id,
      lecturePath: current.path,
      lectureName: current.name,
      label: ctx.threadName || current.name,
      threadName: ctx.threadName,
      summary: ctx.summary || ctx.buildsOn || `${ctx.position || ''}`.trim(),
      position: ctx.position,
      sequenceLabel: ctx.sequenceLabel,
      prerequisite: ctx.prerequisites?.[0] || 'Start by mapping the first concepts in this thread.',
      next: ctx.nextLecture?.name || 'Consolidate this lecture before adding harder material.',
      topics: current.topicHints?.slice(0, 4) || []
    });
  }
  return highlights.sort((a, b) => titleMatchScore(b.threadName, b.courseName) - titleMatchScore(a.threadName, a.courseName));
}

function buildDashboardSuggestions(sortedCourses, world, nextLecture) {
  const suggestions = [];
  if (nextLecture) {
    suggestions.push({
      courseId: nextLecture.courseId,
      courseName: nextLecture.courseName,
      lectureId: nextLecture.id,
      lectureName: nextLecture.name,
      focusTheme: nextLecture.focusTheme || nextLecture.topicHints?.[0] || '',
      reason: `Next grounded block: ${nextLecture.workload.reason}`,
      action: `${nextLecture.workload.recommendedBlockType} for about ${nextLecture.workload.remainingMinutes} min`,
      prerequisite: getLecturePrerequisites(nextLecture.path)[0] || 'Skim the lecture arc first.',
      mode: nextLecture.progress === 'not_started' ? 'Overview first' : nextLecture.workload.recommendedBlockType
    });
  }
  for (const course of sortedCourses.slice(0, 4)) {
    if (suggestions.some((s) => s.courseId === course.courseId)) continue;
    suggestions.push({
      courseId: course.courseId,
      courseName: course.courseName,
      reason: course.behindCount > 0 ? `${course.behindCount} lectures still need a first pass` : `priority ${course.priority}/5, ${course.credits} ECTS`,
      action: course.behindCount > 0 ? 'Start the next untouched lecture and mark the block done when finished' : 'Review the current active lecture and quiz weak spots',
      mode: course.behindCount > 0 ? 'Overview' : 'Review'
    });
  }
  return suggestions.slice(0, 4);
}

function inferPrerequisiteHints(courseName, lectureName, extractedText) {
  const rows = getCourseLectureRows(courseName);
  const previous = rows.slice(-1)[0];
  const ownTopics = extractTopicHints(extractedText).slice(0, 4);
  const prereqs = [];
  if (previous) prereqs.push(`Previous lecture: ${previous.name}`);
  for (const topic of (previous?.topicHints || []).slice(0, 3)) prereqs.push(topic);
  for (const topic of ownTopics.slice(0, 2)) prereqs.push(`Basic meaning of ${topic}`);
  return [...new Set(prereqs)].slice(0, 6);
}

function getPlannerSettings() {
  return {
    weeklyCapacityHours: 14,
    plannerStyle: 'realistic',
    preferredLightStart: true,
    reviewDay: 'Friday',
    dailyStudyDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    protectedLightDays: [],
    coursePriorityOverrides: {},
    ...(store.get('plannerSettings') || {})
  };
}

function collectStudyWorld() {
  const vaultPath = store.get('vaultPath');
  const courses = store.get('courses') || [];
  const plannerSettings = getPlannerSettings();
  const courseRows = [];
  const lectureRows = [];
  let totalOpenEffortMinutes = 0;
  let totalBehindLectures = 0;

  for (const course of courses) {
    const courseDir = vaultPath ? path.join(vaultPath, sanitizeName(course.name)) : '';
    const folders = courseDir && fs.existsSync(courseDir)
      ? fs.readdirSync(courseDir).filter((f) => fs.statSync(path.join(courseDir, f)).isDirectory())
      : [];
    let difficultySum = 0;
    let openCount = 0;
    let activeCount = 0;
    let completedCount = 0;
    const lectures = [];

    folders.forEach((folder, index) => {
      const lecturePath = path.join(courseDir, folder);
      const meta = safeJson(path.join(lecturePath, 'meta.json')) || {};
      const summary = safeRead(path.join(lecturePath, 'summary.md'));
      const concepts = safeRead(path.join(lecturePath, 'concepts.md'));
      const overview = safeRead(path.join(lecturePath, 'overview.md'));
      const extracted = safeRead(path.join(lecturePath, 'extracted.txt'));
      let lectureStructure = safeJson(path.join(lecturePath, 'lecture_structure.json'));
      if (!lectureStructure || lectureStructure.version < 5) {
        lectureStructure = buildLectureStructure({ courseName: course.name, lecturePath, meta, overview, summary, concepts, extracted });
        try { fs.writeFileSync(path.join(lecturePath, 'lecture_structure.json'), JSON.stringify(lectureStructure, null, 2), 'utf8'); } catch {}
      }
      const progress = meta.plannerStatus === 'done' ? 'done' : inferProgress(meta);
      const analysis = estimateLectureWorkload({ course, meta, summary, concepts, overview, extracted, progress, index });
      const lecture = {
        id: folder,
        name: meta.inferredLectureName || folder.replace(/_/g, ' '),
        courseId: course.id,
        courseName: course.name,
        path: lecturePath,
        index,
        progress,
        status: meta.plannerStatus || progress,
        lastActiveAt: meta.activity?.lastActiveAt || meta.processedAt || null,
        processedAt: meta.processedAt || null,
        profile: meta.lectureProfile || detectLectureProfile(`${summary}\n${concepts}\n${overview}\n${extracted}`, course.name),
        topicHints: lectureStructure?.navigableTopics?.map(t => t.label).slice(0, 8) || (Array.isArray(meta.topicHints) ? meta.topicHints.slice(0, 8) : extractTopicHints(`${overview}\n${concepts}\n${summary}`).slice(0, 8)),
        focusTheme: lectureStructure?.focusTheme || meta.focusTheme || '',
        coreThemes: lectureStructure?.coreThemes || meta.coreThemes || [],
        recurringThemes: lectureStructure?.recurringThemes || [],
        workload: analysis
      };
      lectures.push(lecture);
      lectureRows.push(lecture);
      difficultySum += analysis.difficultyScore;
      if (progress !== 'done') {
        openCount += 1;
        totalOpenEffortMinutes += analysis.remainingMinutes;
      } else {
        completedCount += 1;
      }
      if (progress === 'active' || progress === 'started') activeCount += 1;
    });

    totalBehindLectures += openCount;
    const avgDifficulty = lectures.length ? difficultySum / lectures.length : profileDifficulty(course.courseType);
    const priorityOverride = Number(plannerSettings.coursePriorityOverrides?.[course.id] || 0);
    const basePriority = Number(course.priority || 3) + priorityOverride + (course.inFocus ? 1.1 : 0);
    const backlogPressure = openCount ? Math.min(2.4, openCount / 2) : 0;
    const creditPressure = Math.max(1, Number(course.credits || 0)) / 3;
    const attentionScore = Number((basePriority * 1.8 + avgDifficulty * 1.6 + backlogPressure + creditPressure).toFixed(2));
    courseRows.push({
      id: course.id,
      name: course.name,
      emoji: course.emoji || '📚',
      credits: Number(course.credits || 0),
      priority: Number(course.priority || 3),
      inFocus: Boolean(course.inFocus),
      weeklyHours: Number(course.weeklyHours || 0),
      courseType: course.courseType || 'auto',
      moduleGroup: course.moduleGroup || 'General',
      semester: course.semester || 'Unscheduled',
      lectureCount: lectures.length,
      openCount,
      activeCount,
      completedCount,
      avgDifficulty: Number(avgDifficulty.toFixed(2)),
      attentionScore,
      lectures
    });
  }

  courseRows.sort((a, b) => b.attentionScore - a.attentionScore);
  lectureRows.sort((a, b) => b.workload.priorityScore - a.workload.priorityScore);
  const signature = JSON.stringify({
    courses: courseRows.map((c) => [c.id, c.lectureCount, c.openCount, c.activeCount, c.completedCount, c.attentionScore]),
    lectures: lectureRows.map((l) => [l.courseId, l.id, l.progress, l.workload.remainingMinutes])
  });

  return {
    generatedAt: new Date().toISOString(),
    vaultPath: vaultPath || '',
    weeklyCapacityHours: Number(plannerSettings.weeklyCapacityHours || 14),
    totalCourses: courseRows.length,
    totalLectures: lectureRows.length,
    totalBehindLectures,
    totalOpenEffortMinutes,
    courses: courseRows,
    lectures: lectureRows,
    bottlenecks: lectureRows.slice(0, 5).map((l) => ({
      courseName: l.courseName,
      lectureName: l.name,
      reason: l.workload.reason,
      minutes: l.workload.remainingMinutes,
      blockType: l.workload.recommendedBlockType
    })),
    signature
  };
}

function estimateLectureWorkload({ course, meta, summary, concepts, overview, extracted, progress, index }) {
  const corpus = `${meta.inferredLectureName || ''}\n${overview}\n${concepts}\n${summary}\n${extracted.slice(0, 60000)}`;
  const profile = meta.lectureProfile || course.courseType || detectLectureProfile(corpus, course.name);
  const textLength = Math.max(extracted.length, summary.length + concepts.length + overview.length);
  const mathSignals = countMatches(corpus, /(σ|μ|∑|∫|matrix|regression|hypothesis|hypothese|varianz|standardabweich|gleichung|formula|formel|proof|beweis|ableitung|integral|probability|wahrscheinlichkeit)/gi);
  const conceptSignals = countMatches(corpus, /(definition|konzept|concept|framework|model|modell|theory|theorie|argument|claim|mechanism|mechanismus)/gi);
  const methodSignals = countMatches(corpus, /(step|schritt|algorithm|method|verfahren|calculate|compute|berechne|apply|anwenden|checklist|procedure)/gi);
  const topicCount = Array.isArray(meta.topicHints) ? meta.topicHints.length : extractTopicHints(corpus).length;
  const densityScore = Math.min(3, textLength / 14000) + Math.min(1.6, topicCount / 5);
  const mathScore = Math.min(3, mathSignals / 8);
  const conceptualScore = Math.min(2.5, conceptSignals / 12);
  const methodScore = Math.min(2, methodSignals / 10);
  const profileScore = profileDifficulty(profile);
  const difficultyScore = Math.max(1, Math.min(5, profileScore + densityScore * 0.45 + mathScore * 0.65 + conceptualScore * 0.25 + methodScore * 0.3));
  const progressFactor = progress === 'done' ? 0.08 : progress === 'active' ? 0.48 : progress === 'started' ? 0.68 : 1;
  const baseMinutes = 45 + Math.min(115, textLength / 650) + difficultyScore * 16;
  const remainingMinutes = roundTo15(Math.max(progress === 'done' ? 0 : 30, baseMinutes * progressFactor));
  const recommendedBlockType = chooseStudyBlockType({ progress, profile, difficultyScore, mathScore, methodScore, textLength });
  const repeatNeeded = difficultyScore >= 3.9 || profile === 'math_stats' || progress === 'active';
  const priorityScore = Number(((Number(course.priority || 3) + (course.inFocus ? 1 : 0)) * 2.2 + difficultyScore * 1.6 + (progress === 'not_started' ? 2 : progress === 'started' ? 1.2 : 0.7) + Math.max(0, 2 - index * 0.08)).toFixed(2));
  const reasonParts = [];
  if (progress === 'not_started') reasonParts.push('unfinished');
  if (progress === 'started' || progress === 'active') reasonParts.push('already in motion');
  if (profile === 'math_stats') reasonParts.push('math-heavy');
  if (profile === 'reading_heavy') reasonParts.push('reading-heavy');
  if (difficultyScore >= 4) reasonParts.push('dense');
  if (index <= 1) reasonParts.push('foundational early lecture');
  return { textLength, profile, difficultyScore: Number(difficultyScore.toFixed(2)), mathScore: Number(mathScore.toFixed(2)), conceptualScore: Number(conceptualScore.toFixed(2)), methodScore: Number(methodScore.toFixed(2)), densityScore: Number(densityScore.toFixed(2)), remainingMinutes, recommendedBlockType, repeatNeeded, priorityScore, reason: reasonParts.length ? reasonParts.join(', ') : 'steady course progress' };
}

function buildWeeklyPlan({ world, settings = getPlannerSettings(), reason = 'Weekly planning', constraints = {} }) {
  const capacityHours = Number(settings.weeklyCapacityHours || world.weeklyCapacityHours || 14);
  const style = settings.plannerStyle || 'realistic';
  const styleFactor = style === 'lighter' ? 0.86 : style === 'ambitious' ? 1.08 : 1;
  const capacityMinutes = Math.max(60, Math.round(capacityHours * 60 * styleFactor));
  const usableMinutes = Math.min(capacityMinutes, Math.round((world.totalOpenEffortMinutes || capacityMinutes) * 1.15));
  const coursesWithOpen = world.courses.filter((c) => c.openCount > 0);
  const totalScore = coursesWithOpen.reduce((acc, c) => acc + c.attentionScore, 0) || 1;
  const allocations = coursesWithOpen.map((course) => ({ courseId: course.id, courseName: course.name, minutes: roundTo15(Math.max(30, usableMinutes * (course.attentionScore / totalScore))), reason: course.openCount > 0 ? `${course.openCount} open lecture${course.openCount === 1 ? '' : 's'}, difficulty ${course.avgDifficulty}/5, priority ${course.priority}/5` : `maintenance for ${course.priority}/5 priority` }));
  let drift = usableMinutes - allocations.reduce((acc, row) => acc + row.minutes, 0);
  if (allocations.length && Math.abs(drift) >= 15) allocations[0].minutes += drift;

  const blocks = [];
  const usedLectureIds = new Set();
  for (const allocation of allocations) {
    const course = world.courses.find((c) => c.id === allocation.courseId);
    if (!course) continue;
    let remaining = allocation.minutes;
    const candidates = course.lectures.filter((l) => l.progress !== 'done').sort((a, b) => b.workload.priorityScore - a.workload.priorityScore || a.index - b.index);
    for (const lecture of candidates) {
      if (remaining < 30 || usedLectureIds.has(`${lecture.courseId}:${lecture.id}`)) continue;
      const minutes = Math.min(remaining, lecture.workload.remainingMinutes);
      const blockMinutes = roundTo15(Math.max(30, Math.min(minutes, lecture.workload.difficultyScore >= 4 ? 135 : 105)));
      blocks.push(makeStudyBlock(lecture, blockMinutes, lecture.workload.recommendedBlockType, allocation.reason));
      usedLectureIds.add(`${lecture.courseId}:${lecture.id}`);
      remaining -= blockMinutes;
      if (lecture.workload.repeatNeeded && remaining >= 30) {
        const reviewMinutes = Math.min(45, remaining);
        blocks.push(makeStudyBlock(lecture, roundTo15(reviewMinutes), lecture.profile === 'math_stats' ? 'math/problem-practice' : 'revisit', 'second pass recommended by density/difficulty'));
        remaining -= reviewMinutes;
      }
    }
  }

  if (!blocks.length && world.lectures.length) {
    const l = world.lectures[0];
    blocks.push(makeStudyBlock(l, Math.min(60, usableMinutes), 'light review', 'no open backlog detected'));
  }

  const days = distributeBlocksAcrossWeek(blocks, settings, constraints);
  const plannedMinutes = blocks.reduce((acc, b) => acc + b.minutes, 0);
  const courseAllocations = allocations.map((allocation) => ({ ...allocation, hours: Number((allocation.minutes / 60).toFixed(1)) }));
  const narrative = buildPlanNarrative(world, blocks, courseAllocations, capacityHours, style, reason);

  return { id: `plan-${Date.now()}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), weekLabel: getWeekLabel(new Date()), reason, style, capacityHours, plannedMinutes, plannedHours: Number((plannedMinutes / 60).toFixed(1)), worldSignature: world.signature, courseAllocations, days, todayBlocks: getTodayBlocks({ days }), narrative, bottlenecks: world.bottlenecks };
}

function makeStudyBlock(lecture, minutes, blockType, allocationReason) {
  return { id: `block-${lecture.courseId}-${lecture.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, courseId: lecture.courseId, courseName: lecture.courseName, lectureId: lecture.id, lectureName: lecture.name, lecturePath: lecture.path, minutes, blockType, goal: blockGoal(blockType, lecture), status: 'planned', why: `${lecture.workload.reason}; ${allocationReason}`, difficultyScore: lecture.workload.difficultyScore, profile: lecture.profile, topicHints: lecture.topicHints || [] };
}

function distributeBlocksAcrossWeek(blocks, settings, constraints = {}) {
  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const activeDays = settings.dailyStudyDays?.length ? settings.dailyStudyDays : dayNames.slice(0, 6);
  const days = dayNames.map((day) => ({ day, blocks: [], minutes: 0, tone: activeDays.includes(day) ? 'study' : 'buffer' }));
  const activeIndexes = days.map((d, i) => activeDays.includes(d.day) ? i : -1).filter((i) => i >= 0);
  const reviewDay = settings.reviewDay || 'Friday';
  const reviewIndex = dayNames.indexOf(reviewDay);
  const maxPerDay = Math.max(60, Math.ceil(blocks.reduce((a, b) => a + b.minutes, 0) / Math.max(1, activeIndexes.length)) + 45);
  const ordered = [...blocks].sort((a, b) => {
    const reviewA = /review|revisit|quiz|practice/.test(a.blockType) ? 1 : 0;
    const reviewB = /review|revisit|quiz|practice/.test(b.blockType) ? 1 : 0;
    return reviewA - reviewB || b.difficultyScore - a.difficultyScore;
  });
  for (const block of ordered) {
    const preferred = /review|revisit|quiz|practice/.test(block.blockType) && reviewIndex >= 0 ? reviewIndex : null;
    const candidateIndexes = preferred !== null ? [preferred, ...activeIndexes.filter((i) => i !== preferred)] : activeIndexes;
    let target = candidateIndexes[0] ?? 0;
    for (const idx of candidateIndexes) {
      const lightPenalty = constraints.lightToday && idx === getCurrentDayIndex() ? 1000 : 0;
      const score = days[idx].minutes + lightPenalty + (days[idx].minutes + block.minutes > maxPerDay ? 100 : 0);
      const targetScore = days[target].minutes + (days[target].minutes + block.minutes > maxPerDay ? 100 : 0);
      if (score < targetScore) target = idx;
    }
    days[target].blocks.push(block);
    days[target].minutes += block.minutes;
  }
  if (constraints.reviewFriday) {
    const friday = days.find((d) => d.day === 'Friday');
    if (friday) friday.tone = 'review-only preference';
  }
  if (constraints.missedEarlyWeek) {
    for (const day of days) if (day.day === 'Monday' || day.day === 'Tuesday') day.tone = 'missed / carry forward';
  }
  return days;
}

function buildPlanNarrative(world, blocks, allocations, capacityHours, style, reason) {
  const topCourse = allocations[0];
  const topBlock = blocks[0];
  const bottleneck = world.bottlenecks?.[0];
  return { headline: topBlock ? `Start with ${topBlock.lectureName}` : 'No lecture backlog detected', today: topBlock ? `${topBlock.blockType}: ${topBlock.goal}` : 'Use today for light review or adding new material.', week: `${blocks.length} study block${blocks.length === 1 ? '' : 's'} planned inside ${capacityHours}h (${style}).`, priority: topCourse ? `${topCourse.courseName} gets the largest share because ${topCourse.reason}.` : 'No course needs extra attention yet.', bottleneck: bottleneck ? `${bottleneck.lectureName} is a likely bottleneck: ${bottleneck.reason}.` : 'No clear bottleneck yet.', realism: reason };
}

function blockGoal(blockType, lecture) {
  if (blockType === 'lecture overview') return 'Build a fast map before detail work.';
  if (blockType === 'deep dive') return 'Work through the core concepts until the dependency chain is clear.';
  if (blockType === 'math/problem-practice') return 'Do formulas, method steps, and checks slowly enough to catch mistakes.';
  if (blockType === 'interactive quiz') return 'Test recall and mark weak spots for a revisit.';
  if (blockType === 'revisit') return 'Return to the hard pieces and consolidate them.';
  if (blockType === 'summary review') return 'Refresh the summary and key concepts, then close gaps.';
  if (blockType === 'catch-up') return 'Move an untouched lecture from backlog into working memory.';
  return `Make practical progress on ${lecture.name}.`;
}

function chooseStudyBlockType({ progress, profile, difficultyScore, mathScore, methodScore, textLength }) {
  if (progress === 'not_started' && difficultyScore >= 4) return 'lecture overview';
  if (progress === 'not_started') return 'catch-up';
  if (profile === 'math_stats' || mathScore >= 1.2) return 'math/problem-practice';
  if (methodScore >= 1.2) return 'deep dive';
  if (progress === 'active' && difficultyScore >= 3.5) return 'revisit';
  if (textLength < 9000) return 'summary review';
  return 'deep dive';
}

function getTodayBlocks(plan) {
  if (!plan?.days) return [];
  const todayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()];
  const today = plan.days.find((d) => d.day === todayName) || plan.days.find((d) => d.blocks?.length);
  return today ? (today.blocks || []) : [];
}

function parsePlannerInstruction(text) {
  const lower = text.toLowerCase();
  const hoursMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:h|hour|hours|stunden)/);
  const focusMatch = lower.match(/focus (?:more )?on ([a-z0-9 äöüß_-]+)/i) || lower.match(/prioriti[sz]e ([a-z0-9 äöüß_-]+)/i) || lower.match(/catch up in ([a-z0-9 äöüß_-]+)/i);
  return { capacityHours: hoursMatch ? Number(hoursMatch[1]) : null, lighter: /lighter|too tired|tired|easy|less heavy|light week|light plan/.test(lower), ambitious: /ambitious|push|harder|more intense/.test(lower), replan: /re-?plan|rebalance|update|change|missed|only have|less time|more time/.test(lower), lightToday: /today.*(light|lighter|tired|90 minutes|easy)/.test(lower), reviewFriday: /friday.*(review|quiz)/.test(lower), missedEarlyWeek: /missed (monday|tuesday|monday and tuesday)/.test(lower), focusCourseName: focusMatch ? focusMatch[1].trim() : null, doneText: /(already did|finished|completed|done with) (.+)$/i.exec(text)?.[2] || null };
}

function buildLocalPlannerReply(text, world, plan, settings, parsed, changed) {
  const today = getTodayBlocks(plan);
  const first = today[0] || plan.days?.flatMap((d) => d.blocks || [])[0];
  const lines = [];
  if (changed || parsed.replan) lines.push(`I updated the weekly plan around ${settings.weeklyCapacityHours}h.`);
  else lines.push(`I checked the current ${settings.weeklyCapacityHours}h plan against your lectures.`);
  if (first) lines.push(`Today: start with ${first.courseName} - ${first.lectureName} for ${first.minutes} min (${first.blockType}). ${first.why}`);
  if (plan.narrative?.priority) lines.push(plan.narrative.priority);
  if (plan.narrative?.bottleneck) lines.push(plan.narrative.bottleneck);
  if (/what should i do today|today|90 minutes/i.test(text) && today.length > 1) lines.push(`If time is tight, do only the first block; the next-best block is ${today[1].lectureName} (${today[1].minutes} min).`);
  return lines.join('\n\n');
}

function buildPlannerSystemPrompt() {
  return `You are StudyAI's embedded planning assistant. You are not a generic productivity coach. Use the supplied local study-world JSON: courses, lectures, workload estimates, progress, current weekly plan, today blocks, bottlenecks, and settings. Give concrete study actions with minutes, course names, lecture names, study block types, and short grounded reasons. If asked to re-plan, explain the changed plan already computed by the app. Stay concise.`;
}

function compactPlannerContext(world, plan, settings) {
  return { settings, courses: world.courses.map((c) => ({ id: c.id, name: c.name, credits: c.credits, priority: c.priority, openCount: c.openCount, avgDifficulty: c.avgDifficulty, attentionScore: c.attentionScore })), bottlenecks: world.bottlenecks, plan: plan ? { capacityHours: plan.capacityHours, plannedHours: plan.plannedHours, narrative: plan.narrative, courseAllocations: plan.courseAllocations, todayBlocks: getTodayBlocks(plan), days: plan.days?.map((d) => ({ day: d.day, minutes: d.minutes, blocks: d.blocks.map((b) => ({ courseName: b.courseName, lectureName: b.lectureName, minutes: b.minutes, blockType: b.blockType, status: b.status, why: b.why })) })) } : null };
}

function markLecturePlannerActivity(lecturePath, blockType) {
  try {
    const metaPath = path.join(lecturePath, 'meta.json');
    const meta = safeJson(metaPath) || {};
    const now = new Date().toISOString();
    meta.plannerStatus = 'done';
    meta.plannerActivity = [...(meta.plannerActivity || []), { completedAt: now, blockType }].slice(-20);
    meta.activity = meta.activity || { openedCount: 0, tabViews: {}, lastOpenedAt: null, lastActiveAt: null };
    meta.activity.lastActiveAt = now;
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
  } catch (_) {}
}

function markLikelyLectureDone(world, text) {
  const target = String(text || '').toLowerCase();
  const scored = world.lectures.map((lecture) => ({ lecture, score: titleMatchScore(`${lecture.courseName} ${lecture.name}`, target) })).sort((a, b) => b.score - a.score);
  if (!scored[0] || scored[0].score < 0.18) return false;
  markLecturePlannerActivity(scored[0].lecture.path, 'manual planner update');
  return true;
}

function findCourseByText(courses, text) {
  const target = String(text || '').toLowerCase();
  return [...courses].sort((a, b) => titleMatchScore(b.name, target) - titleMatchScore(a.name, target))[0] || null;
}

function titleMatchScore(title, target) {
  const words = new Set(String(target || '').toLowerCase().match(/\b[a-z0-9äöüß]{3,}\b/g) || []);
  const titleWords = String(title || '').toLowerCase().match(/\b[a-z0-9äöüß]{3,}\b/g) || [];
  if (!words.size || !titleWords.length) return 0;
  let hits = 0;
  for (const word of titleWords) if (words.has(word)) hits += 1;
  return hits / Math.max(words.size, titleWords.length);
}

function safeJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function countMatches(text, regex) {
  return (String(text || '').match(regex) || []).length;
}

function profileDifficulty(profile) {
  if (profile === 'math_stats') return 2.2;
  if (profile === 'applied_methods') return 1.8;
  if (profile === 'reading_heavy') return 1.55;
  if (profile === 'conceptual') return 1.35;
  return 1.25;
}

function roundTo15(minutes) {
  return Math.max(15, Math.round(Number(minutes || 0) / 15) * 15);
}

function getCurrentDayIndex() {
  const js = new Date().getDay();
  return js === 0 ? 6 : js - 1;
}

function getWeekLabel(date) {
  const start = new Date(date);
  const day = start.getDay();
  const diff = start.getDate() - day + (day === 0 ? -6 : 1);
  start.setDate(diff);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const opts = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString('en-US', opts)} - ${end.toLocaleDateString('en-US', opts)}`;
}

function sanitizeName(name) {
  return String(name || '')
    .replace(/[^a-zA-Z0-9\u00C0-\u024F\s_-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function hashFileSha256(filePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return null;
  }
}

function listCourseLectureDirs(courseDir) {
  if (!courseDir || !fs.existsSync(courseDir)) return [];
  return fs.readdirSync(courseDir)
    .filter((folder) => {
      try {
        return fs.statSync(path.join(courseDir, folder)).isDirectory();
      } catch {
        return false;
      }
    })
    .map((folder) => ({ folder, dir: path.join(courseDir, folder) }));
}

function collectLectureIdentityKeys(dir, folder, courseName = '') {
  const meta = safeJson(path.join(dir, 'meta.json')) || {};
  const structure = safeJson(path.join(dir, 'lecture_structure.json')) || {};
  const displayName = resolveLectureDisplayName(meta, structure, folder, courseName || meta.course || '');
  const keys = new Set();
  for (const raw of [
    meta.inferredLectureName,
    meta.sourceTitleFromFile,
    structure.focusTheme,
    folder.replace(/__/g, ' ').replace(/_/g, ' '),
    displayName
  ]) {
    const key = topicCanonicalKey(raw);
    if (key && key.length >= 4) keys.add(key);
  }
  const folderBase = folder.replace(/_\d+$/, '').replace(/__+/g, '_');
  const folderKey = topicCanonicalKey(folderBase.replace(/_/g, ' '));
  if (folderKey && folderKey.length >= 4) keys.add(folderKey);
  return { meta, displayName, keys };
}

function isImportedLectureDir(dir) {
  try {
    const metaPath = path.join(dir, 'meta.json');
    if (!fs.existsSync(metaPath) || fs.statSync(metaPath).size < 3) return false;
    const meta = safeJson(metaPath) || {};
    return !!(meta.processedAt || meta.sourceFile);
  } catch {
    return false;
  }
}

/** Remove half-deleted folders (no meta) so re-import is not blocked by leftover PDFs. */
function pruneOrphanLectureDirs(courseDir) {
  for (const { folder, dir } of listCourseLectureDirs(courseDir)) {
    if (isImportedLectureDir(dir)) continue;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      console.warn('Pruned orphan lecture folder:', folder);
    } catch (err) {
      console.warn('Could not prune orphan folder:', folder, err.message);
    }
  }
}

/** Only block when the same PDF (or filename) is already in the vault. Fuzzy title match is not enough — allows re-import after delete. */
function findDuplicateLecture(courseDir, { pdfPath, semanticLectureName, pdfHash, sourceFile, courseName }) {
  const semanticKey = topicCanonicalKey(semanticLectureName);
  const stemKey = topicCanonicalKey(path.basename(pdfPath, path.extname(pdfPath)));

  for (const { folder, dir } of listCourseLectureDirs(courseDir)) {
    if (!isImportedLectureDir(dir)) continue;

    const sig = collectLectureIdentityKeys(dir, folder, courseName);
    const isGerman = (sig.meta.outputLanguage || '') === 'German';

    if (sig.meta.sourceFile && sig.meta.sourceFile === sourceFile) {
      return formatDuplicateHit(folder, dir, sig.displayName, 'same_filename', isGerman, sourceFile);
    }

    if (pdfHash) {
      if (sig.meta.sourceSha256 === pdfHash) {
        return formatDuplicateHit(folder, dir, sig.displayName, 'same_pdf', isGerman);
      }
      const originalPdf = path.join(dir, 'original.pdf');
      if (fs.existsSync(originalPdf)) {
        const existingHash = hashFileSha256(originalPdf);
        if (existingHash && existingHash === pdfHash) {
          return formatDuplicateHit(folder, dir, sig.displayName, 'same_pdf', isGerman);
        }
      }
    }

    // Exact same vault folder slug as this import would use (true re-drop of same lecture id)
    const folderKey = topicCanonicalKey(folder.replace(/_\d+$/, '').replace(/_/g, ' '));
    if (semanticKey && semanticKey.length >= 4 && folderKey === semanticKey) {
      return formatDuplicateHit(folder, dir, sig.displayName, 'same_topic', isGerman);
    }
    const sourceTitleKey = topicCanonicalKey(sig.meta.sourceTitleFromFile || '');
    if (stemKey && stemKey.length >= 4 && sourceTitleKey === stemKey) {
      return formatDuplicateHit(folder, dir, sig.displayName, 'same_topic', isGerman);
    }
  }

  return null;
}

function formatDuplicateHit(folder, dir, lectureName, reason, isGerman, sourceFile = '') {
  const label = lectureName || folder.replace(/_/g, ' ');
  const messages = {
    same_filename: isGerman
      ? `„${sourceFile}" ist bereits als „${label}" importiert.`
      : `"${sourceFile}" is already imported as "${label}".`,
    same_pdf: isGerman
      ? `Diese PDF ist bereits vorhanden („${label}").`
      : `This PDF is already in the vault ("${label}").`,
    same_topic: isGerman
      ? `Diese Vorlesung existiert noch im Vault („${label}"). Lösche sie in der App oder im Ordner, dann erneut importieren.`
      : `This lecture still exists in the vault ("${label}"). Delete it in the app or folder, then import again.`
  };
  return {
    folder,
    path: dir,
    lectureName: label,
    reason,
    message: messages[reason] || (isGerman ? `Bereits vorhanden: „${label}"` : `Already exists: "${label}"`)
  };
}

/** One vault folder per new PDF. Duplicates are rejected before this runs. */
function allocateUniqueLectureFolder(courseDir, semanticLectureName, sourcePdfPath) {
  const sourceStem = sanitizeName(path.basename(sourcePdfPath, path.extname(sourcePdfPath)));
  const semantic = sanitizeName(semanticLectureName) || sourceStem || 'Lecture';

  let baseKey = semantic;
  if (sourceStem) {
    if (topicCanonicalKey(sourceStem) !== topicCanonicalKey(semantic)) {
      baseKey = `${semantic}__${sourceStem}`.slice(0, 96);
    } else if (/\d/.test(sourceStem)) {
      baseKey = `${semantic}_${sourceStem}`.slice(0, 96);
    }
  }

  let folder = baseKey;
  let n = 2;
  while (fs.existsSync(path.join(courseDir, folder))) {
    folder = `${baseKey}_${n}`;
    n += 1;
    if (n > 80) {
      folder = `${baseKey}_${Date.now()}`;
      break;
    }
  }

  return { lectureFolder: folder, lectureDir: path.join(courseDir, folder) };
}

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function inferProgress(meta = {}) {
  const openedCount = meta.activity?.openedCount || 0;
  const totalTabViews = Object.values(meta.activity?.tabViews || {}).reduce((acc, n) => acc + n, 0);
  if (openedCount === 0) return 'not_started';
  if (openedCount >= 2 && totalTabViews >= 4) return 'active';
  return 'started';
}

async function extractPdfText(pdfPath) {
  const pdfParse = require('pdf-parse');
  const pdfBuffer = fs.readFileSync(pdfPath);
  let pdfData;

  try {
    pdfData = await pdfParse(pdfBuffer);
  } catch (parseErr) {
    const err = new Error(parseErr.message);
    err.code = 'PDF_PARSE_ERROR';
    throw err;
  }

  const extractedText = (pdfData.text || '').trim();
  if (!extractedText || extractedText.length < 50) {
    const err = new Error('This PDF appears to be a scanned image. Text extraction failed. Try a text-based PDF.');
    err.code = 'SCANNED_PDF';
    throw err;
  }

  const textForAI = extractedText.length > 80000
    ? extractedText.substring(0, 80000) + '\n\n[Text truncated due to length]'
    : extractedText;

  const pdfBaseName = path.basename(pdfPath, '.pdf');
  return { extractedText, textForAI, pdfBaseName };
}

function isOrganizationalLectureTitle(title = '') {
  const text = String(title || '').trim();
  if (!text) return true;
  const key = topicCanonicalKey(text);
  if (/\b(organisatorisch|organisatorisches|kommunikationskan|übungsgruppe|übungsbeginn|moodle|tutorium|sprechstunde|anmeldung|prüfungsanmeldung|kursinfo|semesterplan|vorlesungsplan|vorlesungsinhalte|woche\s*inhalte|lernziele\s+der\s+vorlesung)\b/i.test(key)) return true;
  if (/^organisatorisches?\s*(einf|intro|einleitung|einfuehrung|einführung)?$/.test(key)) return true;
  if (/^(einleitung|einfuehrung|einführung|overview|übersicht|agenda)$/.test(key)) return true;
  if (isBadTopicLabel(text, { raw: text, source: 'title', language: 'German' })) return true;
  return false;
}

function resolveLectureDisplayName(meta = {}, lectureStructure = null, lectureFolder = '', courseName = '') {
  const language = lectureStructure?.language || meta.outputLanguage || detectLanguage(meta.inferredLectureName || '');
  const courseTerms = buildCourseTermSet(courseName || meta.course || '', meta);
  const candidates = [
    lectureStructure?.focusTheme,
    ...(Array.isArray(lectureStructure?.coreThemes) ? lectureStructure.coreThemes : []),
    ...(Array.isArray(lectureStructure?.navigableTopics) ? lectureStructure.navigableTopics.map((t) => t.label) : []),
    ...(Array.isArray(lectureStructure?.deepDiveTopics) ? lectureStructure.deepDiveTopics.map((t) => t.label) : []),
    meta.inferredLectureName,
    meta.sourceTitleFromFile,
    lectureFolder.replace(/__/g, ' · ').replace(/_/g, ' ')
  ].filter(Boolean);

  for (const raw of candidates) {
    const clean = cleanTopicLabel(String(raw), language, courseTerms);
    if (clean && clean.length >= 4 && !isOrganizationalLectureTitle(clean) && !isNearCourseMetadata(clean, courseName, meta)) {
      return clean.slice(0, 88);
    }
  }

  const folderLabel = lectureFolder.replace(/__/g, ' · ').replace(/_/g, ' ').trim();
  return folderLabel || 'Lecture';
}

function normalizeLectureName(baseName, extractedText = '') {
  const raw = String(baseName || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  const withoutNoise = raw
    .replace(/\b(slides?|script|notes?|handout|final|draft|copy|scan|merged|export|download)\b/ig, '')
    .replace(/\b(pdf|pptx?|key|pages?)\b/ig, '')
    .replace(/^(lecture|lec|vorlesung|vl|session|woche|week)\s*[-:_#]?\s*\d{1,3}\s*[-:_.]?\s*/i, '')
    .replace(/^\d{1,3}\s*[-:_.]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const headings = extractTopicHints(extractedText)
    .filter((h) => !/^(agenda|outline|contents?|references|literatur|organisatorisches|einleitung)$/i.test(h))
    .filter((h) => !isOrganizationalLectureTitle(h));
  const firstHeading = headings.find((h) => h.length >= 6 && h.length <= 72);
  const fromFile = withoutNoise.length >= 8 && !/^\d+$/.test(withoutNoise) ? withoutNoise : '';
  const fileIsOrg = isOrganizationalLectureTitle(fromFile);
  const candidate = fileIsOrg ? (firstHeading || fromFile) : (fromFile || firstHeading);
  const merged = candidate && firstHeading && !fileIsOrg && titleMatchScore(candidate, firstHeading) < 0.25 && candidate.length < 36
    ? `${candidate} - ${firstHeading}`
    : (candidate || firstHeading || raw || 'Lecture');
  const titled = toTitle(merged)
    .replace(/\bPdf\b/g, '')
    .replace(/\bPptx?\b/ig, '')
    .replace(/\s+-\s+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 88);
  return isOrganizationalLectureTitle(titled) && firstHeading ? toTitle(firstHeading).slice(0, 88) : titled;
}

function chooseSuggestedCourse(courses, text) {
  const haystack = (text || '').toLowerCase();
  let best = null;
  for (const course of courses || []) {
    const tokens = `${course.name} ${course.description || ''} ${course.moduleGroup || ''}`.toLowerCase().split(/\s+/).filter(Boolean);
    const score = tokens.reduce((acc, token) => acc + (haystack.includes(token) ? 1 : 0), 0);
    if (!best || score > best.confidence) {
      best = { id: course.id, confidence: score };
    }
  }
  return best && best.confidence > 0 ? best : null;
}

function extractTopicHints(text) {
  const lines = (text || '').split('\n').map(l => l.trim()).filter(Boolean);
  const candidates = [];
  for (const line of lines) {
    const clean = line.replace(/^[-*•\d.)\s]+/, '').replace(/\s+/g, ' ').trim();
    if (clean.length < 6 || clean.length > 95) continue;
    if (/^(agenda|outline|contents|references|literatur|table of contents)$/i.test(clean)) continue;
    if (/^#{1,4}\s+/.test(line) || /^[A-ZÄÖÜ][A-Za-zÄÖÜäöüß0-9 ,:()/%–-]{5,95}$/.test(clean) || /\*\*.+\*\*/.test(line)) {
      candidates.push(clean.replace(/^#{1,4}\s+/, '').replace(/\*+/g, ''));
    }
    const bold = [...line.matchAll(/\*\*(.+?)\*\*/g)].map((m) => m[1].trim());
    candidates.push(...bold.filter((x) => x.length >= 4 && x.length <= 80));
    if (candidates.length >= 35) break;
  }
  const unique = [];
  for (const cand of candidates) {
    if (!unique.some(u => u.toLowerCase() === cand.toLowerCase())) unique.push(cand);
  }
  return unique.slice(0, 12);
}

function toTitle(value) {
  return value
    .split(' ')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function slugify(value) {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function detectLanguage(text = '') {
  const sample = (text || '').slice(0, 12000).toLowerCase();
  const germanHits = (sample.match(/\b(der|die|das|und|nicht|mit|für|eine|einer|vorlesung|aufgabe|beispiel|konzept)\b/g) || []).length;
  const englishHits = (sample.match(/\b(the|and|with|not|for|example|concept|lecture|topic|question)\b/g) || []).length;
  const hasUmlaut = /[äöüß]/i.test(sample);
  if (hasUmlaut || germanHits >= englishHits + 3) return 'German';
  if (englishHits >= germanHits + 3) return 'English';
  return 'German';
}

function chooseOutputLanguage(courseName, extractedText, courseMeta = {}) {
  const preference = store.get('outputLanguagePreference') || 'auto';
  if (preference && preference !== 'auto') return preference;
  if (courseMeta.language && courseMeta.language !== 'auto') return courseMeta.language;
  return detectLanguage(`${courseName}\n${extractedText}`);
}

function readLectureLanguage(lecturePath, fallbackText = '') {
  const preference = store.get('outputLanguagePreference') || 'auto';
  if (preference && preference !== 'auto') return preference;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(lecturePath, 'meta.json'), 'utf8'));
    if (meta.outputLanguage) return meta.outputLanguage;
  } catch {}
  return detectLanguage(fallbackText);
}

function normalizeQuiz(parsed, { language, topicSlug, difficulty, count }) {
  return {
    language,
    topicSlug,
    difficulty,
    questions: (parsed.questions || []).slice(0, count).map((q, i) => ({
      id: String(q.id || `q${i + 1}`),
      prompt: String(q.prompt || ''),
      options: Array.isArray(q.options) ? q.options.slice(0, 4).map((o) => String(o)) : [],
      correctIndex: Number.isInteger(q.correctIndex) ? Math.max(0, Math.min(3, q.correctIndex)) : 0,
      explanation: String(q.explanation || ''),
      weakPoint: String(q.weakPoint || '')
    })).filter((q) => q.prompt && q.options.length >= 2)
  };
}

function updateMetaAfterQuiz(lecturePath, score = {}) {
  try {
    const metaPath = path.join(lecturePath, 'meta.json');
    const meta = safeJson(metaPath) || {};
    const pct = score.total ? score.correct / score.total : 0;
    meta.quizState = { lastScore: score, lastCompletedAt: new Date().toISOString(), needsRevisit: pct < 0.7 };
    if (pct >= 0.8 && meta.plannerStatus !== 'done') meta.progress = 'active';
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
  } catch (_) {}
}

function buildOfflineLectureAnswer(question, combined, language) {
  const qWords = new Set(String(question || '').toLowerCase().match(/\b[a-zäöüß0-9]{4,}\b/g) || []);
  const lines = String(combined || '').split('\n').map((l) => l.trim()).filter((l) => l.length > 20 && l.length < 320);
  const ranked = lines.map((line) => {
    const lower = line.toLowerCase();
    let score = 0;
    for (const word of qWords) if (lower.includes(word)) score += 1;
    return { line, score };
  }).filter((row) => row.score > 0).sort((a, b) => b.score - a.score).slice(0, 4);
  if (ranked.length === 0) {
    return language === 'German'
      ? 'Ich habe keinen API-Schluessel fuer eine freie Antwort gefunden und in den lokalen Lecture-Materialien keine eindeutige passende Stelle erkannt. Oeffne Summary/Concepts oder fuege einen API-Key hinzu fuer eine echte kontextuelle Antwort.'
      : 'I do not have an API key for a free-form answer, and I could not find a clear matching passage in the local lecture materials. Open Summary/Concepts or add an API key for a grounded contextual answer.';
  }
  const intro = language === 'German' ? 'Offline-Hinweis aus den lokalen Materialien:' : 'Offline hint from the local materials:';
  const closing = language === 'German' ? 'Fuer eine erklaerende Antwort mit Schritten bitte API-Key setzen.' : 'For an explanatory step-by-step answer, add an API key.';
  return `${intro}\n\n${ranked.map((row) => `- ${row.line}`).join('\n')}\n\n${closing}`;
}


function parseQuizJson(raw) {
  const text = (raw || '').trim();
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const payload = fenced ? fenced[1].trim() : text;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function parseStudyCardJson(raw) {
  const parsed = parseQuizJson(raw);
  if (parsed && typeof parsed === 'object') return parsed;
  return null;
}

function buildStudyCardMarkdown(parsed, language = 'German') {
  const isGerman = language === 'German';
  const lines = [];
  if (parsed.title) lines.push(`# ${parsed.title}`, '');
  if (parsed.gist) {
    lines.push(`## ${isGerman ? 'Kern' : 'Gist'}`, parsed.gist, '');
  }
  if (parsed.keyPoints?.length) {
    lines.push(`## ${isGerman ? 'Wichtigste Punkte' : 'Key points'}`);
    for (const p of parsed.keyPoints) lines.push(`- ${p}`);
    lines.push('');
  }
  if (parsed.openQuestions?.length) {
    lines.push(`## ${isGerman ? 'Offen / unklar' : 'Still open'}`);
    for (const p of parsed.openQuestions) lines.push(`- ${p}`);
    lines.push('');
  }
  if (parsed.reviewTriggers?.length) {
    lines.push(`## ${isGerman ? 'Wann wiederholen' : 'When to revisit'}`);
    for (const p of parsed.reviewTriggers) lines.push(`- ${p}`);
    lines.push('');
  }
  if (parsed.connections?.length) {
    lines.push(`## ${isGerman ? 'Verbindungen' : 'Connections'}`);
    for (const p of parsed.connections) lines.push(`- ${p}`);
  }
  return lines.join('\n').trim();
}

function buildStudyCardPrompt(language) {
  const isGerman = language === 'German';
  return isGerman
    ? `Du erstellst eine persönliche Lernkarte aus den EIGENEN Notizen des Studierenden. Die Notizen sind die Hauptquelle; Vorlesungsmaterial nur zur Korrektur und Vertiefung. Schreibe auf Deutsch. Keine Uni-Metadaten. Die Karte soll kompakt, ehrlich und prüfungsnah sein — was der/die Studierende wirklich mitnehmen will.`
    : `You create a personal study card from the student's OWN notes. Notes are the primary source; lecture materials only ground and clarify. Write in ${language}. No university metadata. Keep the card compact, honest, and exam-useful.`;
}

function detectLectureProfile(text = '', courseName = '') {
  const sample = `${courseName}\n${text}`.slice(0, 30000).toLowerCase();
  const nameHint = sample.slice(0, 500);
  const mathSignals = (sample.match(/(σ|μ|∑|∫|p\(|z-score|varianz|standardabweich|regression|hypothese|konfidenz|matrix|ableitung|integral|gleichung|formel|stichprobe)/g) || []).length;
  const codeSignals = (sample.match(/\b(def |class |import |function |return |python|javascript|typescript|array|loop|debug|syntax|variable|print\(|console\.|numpy|pandas|git)\b/g) || []).length;
  const psychSignals = (sample.match(/\b(psychologie|psychology|studie|hypothese|experiment|kognition|verhalten|theorie|modell|skala|messung|stichprobe)\b/g) || []).length;
  const methodSignals = (sample.match(/\b(step|schritt|verfahren|algorithm|method|ablauf|berechne|bestimme|wende an|compute|calculate)\b/g) || []).length;
  const conceptualSignals = (sample.match(/\b(theory|theorie|definition|begriff|konzept|modell|framework|history|geschichte)\b/g) || []).length;
  const readingSignals = (sample.match(/\b(chapter|kapitel|paper|artikel|literatur|reading|essay|textanalyse)\b/g) || []).length;

  if (/python|programm|informatik|software|coding|gpt|java|javascript|typescript|c\+\+/.test(nameHint) && codeSignals >= 2) return 'programming';
  if (codeSignals >= 5) return 'programming';
  if (mathSignals >= 6) return 'math_stats';
  if (psychSignals >= 5 && psychSignals >= mathSignals) return 'psychology';
  if (methodSignals >= conceptualSignals + 3) return 'applied_methods';
  if (readingSignals >= 5) return 'reading_heavy';
  return 'conceptual';
}

function resolveLectureProfile(courseMeta = {}, extractedText = '', courseName = '') {
  const t = String(courseMeta.courseType || 'auto').toLowerCase();
  if (t === 'math' || t === 'math_stats') return 'math_stats';
  if (t === 'statistics' || t === 'stats') return 'math_stats';
  if (t === 'programming' || t === 'code') return 'programming';
  if (t === 'psychology' || t === 'psych') return 'psychology';
  if (t === 'applied_methods' || t === 'methods') return 'applied_methods';
  if (t === 'reading' || t === 'reading_heavy') return 'reading_heavy';
  if (t === 'conceptual') return 'conceptual';
  return detectLectureProfile(extractedText, courseName);
}

function readLectureProfile(lecturePath, fallbackText = '') {
  try {
    const meta = safeJson(path.join(lecturePath, 'meta.json')) || {};
    const courseMeta = getCourseMetaByName(meta.course || '');
    const merged = { ...courseMeta, ...meta, courseType: courseMeta.courseType || meta.courseType };
    if (meta.lectureProfile && merged.courseType === 'auto') return meta.lectureProfile;
    return resolveLectureProfile(merged, fallbackText, meta.course || '');
  } catch {}
  return detectLectureProfile(fallbackText, '');
}

function profileLabel(profile, language = 'German') {
  const isGerman = language === 'German';
  const map = {
    programming: isGerman ? 'Programmierung' : 'Programming',
    math_stats: isGerman ? 'Mathematik/Statistik' : 'Math/Statistics',
    psychology: isGerman ? 'Psychologie' : 'Psychology',
    applied_methods: isGerman ? 'Methoden' : 'Applied methods',
    reading_heavy: isGerman ? 'Lesestoff' : 'Reading-heavy',
    conceptual: isGerman ? 'Konzeptuell' : 'Conceptual'
  };
  return map[profile] || map.conceptual;
}

function buildStudyPath(structure = {}, language = 'German') {
  const isGerman = language === 'German';
  const seq = structure.courseSequence || {};
  const units = (structure.topicTree || []).slice(0, 4).map((theme, i) => ({
    id: theme.id || `unit-${i + 1}`,
    label: theme.label,
    subtopics: (theme.subtopics || []).slice(0, 3),
    order: i + 1,
    steps: [
      { id: 'explain', label: isGerman ? 'Verstehen' : 'Understand', tab: 'deepDive', mode: 'explain' },
      { id: 'example', label: isGerman ? 'Beispiel' : 'Example', tab: 'deepDive', mode: 'example' },
      { id: 'practice', label: isGerman ? 'Üben' : 'Practice', tab: 'aufgaben' }
    ]
  }));
  const courseLinks = [];
  if (seq.previousName) {
    courseLinks.push({
      type: 'buildsOn',
      label: seq.buildsOn || (isGerman ? `Baut auf „${seq.previousName}" auf` : `Builds on “${seq.previousName}”`),
      priorLectureName: seq.previousName,
      priorLecturePath: seq.previousPath || null,
      priorLectureId: seq.previousId || null,
      tab: 'overview',
      hint: isGerman ? 'Zuerst kurz die vorherige Vorlesung in Overview wiederholen' : 'Skim the previous lecture overview first'
    });
  }
  for (const r of (structure.recurringThemes || []).slice(0, 4)) {
    for (const hit of (r.hits || []).slice(0, 2)) {
      courseLinks.push({
        type: 'recurring',
        label: r.label,
        priorLectureName: hit.lectureName,
        priorLecturePath: hit.lecturePath || null,
        priorLectureId: hit.lectureId || null,
        relation: hit.relation || '',
        tab: 'concepts'
      });
    }
  }
  const intro = units.length
    ? (isGerman
      ? `${seq.label || 'Diese Vorlesung'}: ${units.length} Kernthemen nacheinander lernen — jedes mit Verstehen → Beispiel → Üben.`
      : `${seq.label || 'This lecture'}: learn ${units.length} core units in order — understand → example → practice.`)
    : '';
  return { units, courseLinks, intro };
}

function getPriorLectureMaterials(courseName, lecturePath) {
  const rows = getEnrichedCourseRows(courseName);
  const idx = rows.findIndex((r) => r.path === lecturePath);
  if (idx <= 0) return '';
  const prev = rows[idx - 1];
  const pPath = prev.path;
  const overview = safeRead(path.join(pPath, 'overview.md')).slice(0, 6000);
  const concepts = safeRead(path.join(pPath, 'concepts.md')).slice(0, 6000);
  const structure = safeJson(path.join(pPath, 'lecture_structure.json'));
  return [
    `Previous lecture: ${prev.name} (${prev.sequenceLabel || ''})`,
    structure?.focusTheme ? `Focus: ${structure.focusTheme}` : '',
    overview,
    concepts
  ].filter(Boolean).join('\n\n');
}

function deepDiveModeFilePath(lecturePath, slug, mode = 'explain') {
  const safeMode = String(mode || 'explain').replace(/[^a-z0-9_-]/gi, '');
  return path.join(lecturePath, 'deep_dives', `${slug}__${safeMode || 'explain'}.md`);
}

function groundingRules() {
  return `Grounding: use only ideas, terms, definitions, and examples that appear in the lecture text. Name them explicitly. Avoid generic filler ("important to understand", "useful concept") with no referent. If the PDF is thin on a point, say what is missing instead of inventing.`;
}

function mathFormattingRules() {
  return `Mathematical notation: Use LaTeX inside markdown math delimiters—$...$ for inline (e.g. $A \\cup B$, $P(M)$, $\\mathbb{E}[X]$) and $$...$$ for display / multi-line. Use standard LaTeX (\\cap, \\frac, \\sum, Greek letters, operators). Prefer $...$ over raw \\(...\\); the app also normalizes legacy \\(...\\) when it appears.`;
}

function mathFormattingRulesShort() {
  return `If the material includes formulas or symbols, use LaTeX in $...$ (inline) and $$...$$ (display).`;
}

function buildSummaryPrompt(language, profile) {
  const isGerman = language === 'German';
  const base = `You are a study assistant for university students. Write in ${language}. ${groundingRules()} Teach ONE coherent narrative — not a topic list. Max 4 central ideas; put examples under those ideas.`;
  const headings = isGerman
    ? `Use German headings: ## Gesamtzusammenfassung, ## Aufbau der Vorlesung, ## Zentrale Inhalte, ## Was man behalten sollte, ## Verbindung zur Kurslogik.`
    : `Use headings: ## Whole-lecture summary, ## Lecture structure, ## Main content, ## What to retain, ## Connection to the course logic.`;
  if (profile === 'math_stats') {
    return `${base} ${mathFormattingRules()} The Summary is NOT the map; it is the content-rich explanation of the whole lecture. ${headings} Explain notation and procedures in lecture order, including assumptions, applications, and typical errors.`;
  }
  if (profile === 'programming') {
    return `${base} ${headings} Trace what the code/demo in the lecture actually does, in execution order. Name inputs, outputs, control flow, and one concrete run-through. Avoid abstract CS jargon not in the PDF.`;
  }
  if (profile === 'psychology') {
    return `${base} ${headings} Explain constructs, how they are measured/operationalized, and how claims are supported. Separate correlation vs causation when relevant.`;
  }
  if (profile === 'applied_methods') {
    return `${base} The Summary is NOT the map; it is the content-rich explanation of the whole lecture. ${headings} Explain the methods, decision rules, execution logic, inputs/outputs, and edge cases in lecture order.`;
  }
  if (profile === 'reading_heavy') {
    return `${base} The Summary is NOT the map; it is the content-rich explanation of the whole lecture. ${headings} Cover the argument, claims, evidence, terms, tensions, and named sources in order.`;
  }
  return `${base} The Summary is NOT the map; it is the content-rich explanation of the whole lecture. ${headings} Make it broad, coherent, and faithful to the whole session.`;
}

function buildConceptPrompt(language, profile) {
  const isGerman = language === 'German';
  const g = `Write in ${language}. ${groundingRules()} Use markdown. Concepts must come from the lecture's real Fokusthema / focus theme, Kernthemen / core themes, and Unterthemen / subtopics. Do not output generic keywords. Keep concept names in the lecture language.`;
  if (profile === 'math_stats') {
    return `${g} ${mathFormattingRules()} ${isGerman ? 'Use German headings: ## Konzeptuelle Bausteine, ## Symbole & Objekte, ## Methoden und Voraussetzungen, ## Beziehungen im Kursfaden, ## Wiederkehrende Themen.' : 'Use headings: ## Conceptual building blocks, ## Symbols & objects, ## Methods and prerequisites, ## Relationships in the course thread, ## Recurring themes.'} For each concept: definition → when to use → typical mistake → link to prior lecture if implied.`;
  }
  if (profile === 'programming') {
    return `${g} ${isGerman ? 'Use German headings: ## Bausteine, ## Syntax & Muster, ## Ablauf einer Ausführung, ## Typische Fehler, ## Bezug zu früheren Vorlesungen.' : 'Use headings: ## Building blocks, ## Syntax & patterns, ## Execution flow, ## Typical bugs, ## Link to earlier lectures.'} Per concept: what it does in code, prerequisite idea, common bug.`;
  }
  if (profile === 'psychology') {
    return `${g} ${isGerman ? 'Use German headings: ## Konstrukte, ## Operationalisierung, ## Zusammenhänge, ## Grenzen der Evidenz, ## Bezug im Kurs.' : 'Use headings: ## Constructs, ## Operationalization, ## Relationships, ## Limits of evidence, ## Place in course.'} Per construct: definition, how measured, what it explains, limitation.`;
  }
  return `${g} ${isGerman ? 'Use German headings: ## Konzeptuelle Bausteine, ## Kernthemen und Unterthemen, ## Beziehungen, ## Voraussetzungen vs. Erweiterungen, ## Wiederkehrende Themen.' : 'Use headings: ## Conceptual building blocks, ## Core themes and subtopics, ## Relationships, ## Prerequisites vs extensions, ## Recurring themes.'} For each concept, explain why it belongs to the lecture structure and how it connects to other concepts.`;
}

function buildOverviewPrompt(language, profile) {
  const isGerman = language === 'German';
  const head = `Write in ${language} as StudyAI's high-level intellectual map of THIS lecture. ${groundingRules()} Keep topic names, subtopic names, and technical labels in the lecture language. The Overview must identify real lecture structure, not generic summary prose.`;
  if (isGerman) {
    return `${head}

${profile === 'math_stats' ? mathFormattingRules() : mathFormattingRulesShort()}

Use these exact headings:

## Fokusthema
One precise sentence: what this lecture is mainly about.

## Kernthemen
3-6 bullets. Each bullet: **theme name** - why it is central.

## Unterthemen und Navigation
Grouped bullets: **Kernthema** -> subtopics underneath it. These labels should be usable as Deep Dive topics.

## Aufbau der Vorlesung
The lecture arc in document order.

## Was ist zentral, was unterstützt nur?
Separate central ideas from supporting examples/details.

## Voraussetzungen und Anschluss
What should be understood before this, and what this prepares for later.

## Wiederkehrende Kursfäden
Name ideas that likely continue from earlier or return later, using only evidence from this lecture/course context.`;
  }
  return `${head}

${profile === 'math_stats' ? mathFormattingRules() : mathFormattingRulesShort()}

Use these exact headings:

## Focus Theme
One precise sentence: what this lecture is mainly about.

## Core Themes
3-6 bullets. Each bullet: **theme name** - why it is central.

## Subtopics & Navigation
Grouped bullets: **Core theme** -> subtopics underneath it. These labels should be usable as Deep Dive topics.

## Lecture Structure
The lecture arc in document order.

## Central vs Supporting
Separate central ideas from supporting examples/details.

## Prerequisites & Continuation
What should be understood before this, and what this prepares for later.

## Recurring Course Threads
Name ideas that likely continue from earlier or return later, using only evidence from this lecture/course context.`;
}

function buildRegenerateOverviewPrompt(language) {
  return `Write in ${language}. Rebuild the lecture's conceptual map (Markdown) using ONLY the Summary and Concepts given in the user message.

${groundingRules()}

${mathFormattingRulesShort()}

Sections (exact headings):

## Lecture arc
Session flow in order, using terminology from Summary/Concepts.

## Concept map (relationships)
Lines: **A** *[relation]* **B** with relation words: builds_on, requires, enables, contrasts_with, part_of — must be faithful to the summaries.

## Study sequence (dependency order)
Numbered: learn in this order; not alphabetical.

## Pitfalls & checkpoints
Specific confusions implied by the materials.

## 10-minute review path
Micro-tasks that reference named ideas from Summary/Concepts only.`;
}

function buildLectureQuizPrompt(language, profile, count) {
  if (profile === 'math_stats') {
    return `Write in ${language}. ${mathFormattingRules()} Generate exactly ${count} questions grounded in THIS lecture only. Mix: when to use which method, order of steps, and interpretation. For each: ### Qn, - Expected answer (references named ideas from the text), - Why this matters. No invented scenarios absent from the materials.`;
  }
  return `Write in ${language}. Generate exactly ${count} recall + understanding questions that a student could answer using ONLY the lecture text. For each: ### Qn, - Expected answer (specific), - Why this matters. Avoid generic self-help questions.`;
}

function buildDeepDivePrompt(language, profile, topic) {
  return buildDeepDivePromptForMode(language, profile, topic, 'explain', '');
}

function buildDeepDivePromptForMode(language, profile, topic, mode = 'explain', compareContext = '', topicCtx = {}) {
  const isGerman = language === 'German';
  const languageRule = `Write in ${language}. Keep headings and explanations in ${language}; keep source terms as labels. ${groundingRules()}`;
  const parentNote = topicCtx.parent
    ? (isGerman ? `Unterthema von „${topicCtx.parent}".` : `Subtopic of "${topicCtx.parent}".`)
    : '';
  const topicLine = `You teach ONLY the topic "${topic}" using the lecture materials. ${parentNote}`;
  const modes = {
    explain: isGerman
      ? `${topicLine} Goal: VERSTEHEN. Structure with ## headings you choose (4–6). Start with intuition, then definition/notation, then role in THIS lecture, then link to course thread/prerequisites, end with ## Mini-Check (2 short questions). No admin boilerplate.`
      : `${topicLine} Goal: UNDERSTAND. Use 4–6 ## sections: intuition, definition, role in this lecture, course links, ## Mini-Check (2 questions).`,
    example: isGerman
      ? `${topicLine} Goal: EIN BEISPIEL. Exactly ONE worked example from the materials. Use ## Ausgangslage ## Lösungsschritte ## Ergebnis ## Worauf achten. Use lecture notation/numbers/code exactly.`
      : `${topicLine} Goal: ONE WORKED EXAMPLE. ## Setup ## Steps ## Result ## What to notice.`,
    trap: isGerman
      ? `${topicLine} Goal: PRÜFUNGSFALLE. ## Typischer Fehler ## Warum man das verwechselt ## Richtige Argumentation ## Merksatz`
      : `${topicLine} Goal: EXAM TRAP. ## Typical mistake ## Why students confuse it ## Correct reasoning ## Rule of thumb`,
    compare: isGerman
      ? `${topicLine} Goal: KURSVERBINDUNG. Compare this topic to the PRIOR lecture. Use ## Was bleibt gleich ## Was ist neu ## Was man nicht verwechseln darf ## Kurz-Checkliste. Prior lecture materials:\n${compareContext || '(keine vorherige Vorlesung)'}`
      : `${topicLine} Goal: COURSE LINK. ## What stayed the same ## What is new ## What not to confuse. Prior lecture:\n${compareContext || '(none)'}`
  };
  let body = modes[mode] || modes.explain;

  if (profile === 'programming') {
    const codeRules = isGerman
      ? `KURSTYP: Programmierung. Pflicht: Mindestens ZWEI fenced Codeblöcke (\`\`\`python oder Sprache der Vorlesung) mit echtem Code aus den Materialien — keine rein textuelle Erklärung ohne Code. Nach jedem Block: Zeile-für-Zeile oder Block-für-Block. Zeige Variablenwerte, Ausgabe, typische Fehler. Modus „Beispiel“: vollständiges lauffähiges Mini-Programm aus der Vorlesung.`
      : `COURSE TYPE: Programming. REQUIRED: At least TWO fenced code blocks (\`\`\`python or lecture language) with real code from materials — not prose-only. After each block: line-by-line or chunk-by-chunk explanation with variables, output, typical bugs. Mode "example": one complete runnable mini-program from the lecture.`;
    body = `${languageRule} ${codeRules} ${body}`;
  } else if (profile === 'math_stats') {
    body = `${languageRule} ${mathFormattingRules()} ${body}`;
  } else if (profile === 'psychology') {
    body = `${languageRule} ${body} ${isGerman ? 'Konstrukt, Operationalisierung, Evidenzgrenzen — keine rein allgemeine Psychologie.' : 'Construct, operationalization, evidence limits — not generic psychology.'}`;
  } else if (profile === 'applied_methods') {
    body = `${languageRule} ${body} ${isGerman ? 'Schritte, Entscheidungsregeln, Eingaben/Ausgaben.' : 'Steps, decision rules, inputs/outputs.'}`;
  } else {
    body = `${languageRule} ${body}`;
  }
  return body;
}

function buildSubtopicPrompt(language, profile, subtopic) {
  const isGerman = language === 'German';
  const adaptive = `Teach "${subtopic}" as a focused extension of the parent deep dive. Choose 3–5 ## sections that fit this subtopic (do not repeat the parent wholesale). Write in ${language}.`;
  if (profile === 'programming') {
    return `${adaptive} ${isGerman ? 'Pflicht: mindestens ein ``` Codeblock mit echtem Code; erkläre Ausführung und eine typische Fehlerquelle.' : 'REQUIRED: at least one ``` code block with real code; explain execution and one typical bug.'}`;
  }
  if (profile === 'math_stats') {
    return `${adaptive} ${mathFormattingRules()} Prefer steps, traps, and a tiny verification when appropriate.`;
  }
  return `${adaptive} Stay grounded in the parent deep dive only.`;
}

function normalizeAufgaben(parsed, { language, count = 6 }) {
  const typeMap = {
    calculation: language === 'German' ? 'Rechenaufgabe' : 'Calculation',
    proof: language === 'German' ? 'Beweis' : 'Proof',
    concept: language === 'German' ? 'Verständnis' : 'Concept',
    application: language === 'German' ? 'Anwendung' : 'Application'
  };
  const exercises = (parsed?.exercises || []).slice(0, count).map((ex, i) => {
    const rawType = String(ex.type || 'concept').toLowerCase();
    const typeKey = ['calculation', 'proof', 'concept', 'application'].includes(rawType) ? rawType : 'concept';
    return {
      id: String(ex.id || `a${i + 1}`),
      title: String(ex.title || (language === 'German' ? `Aufgabe ${i + 1}` : `Exercise ${i + 1}`)),
      topic: String(ex.topic || ''),
      type: typeKey,
      typeLabel: typeMap[typeKey],
      difficulty: ['easy', 'medium', 'hard'].includes(String(ex.difficulty || '').toLowerCase())
        ? String(ex.difficulty).toLowerCase()
        : 'medium',
      prompt: String(ex.prompt || '').trim(),
      hints: Array.isArray(ex.hints) ? ex.hints.map((h) => String(h).trim()).filter(Boolean).slice(0, 3) : [],
      solution: String(ex.solution || '').trim(),
      checkQuestion: String(ex.checkQuestion || '').trim(),
      sourceNote: String(ex.sourceNote || '').trim()
    };
  }).filter((ex) => ex.prompt.length >= 12);
  return {
    version: 1,
    language,
    generatedAt: new Date().toISOString(),
    exercises
  };
}

function buildAufgabenMarkdown(aufgaben = {}) {
  const isGerman = aufgaben.language === 'German';
  const lines = [
    `# ${isGerman ? 'Aufgaben' : 'Exercises'}`,
    '',
    isGerman
      ? 'Übungsaufgaben aus der Vorlesung — erst selbst lösen, dann Lösung anzeigen.'
      : 'Practice tasks from the lecture — try yourself first, then reveal the solution.',
    ''
  ];
  for (const ex of aufgaben.exercises || []) {
    lines.push(`## ${ex.title}`, '');
    if (ex.topic) lines.push(`*${isGerman ? 'Thema' : 'Topic'}: ${ex.topic} · ${ex.typeLabel} · ${ex.difficulty}*`, '');
    lines.push(ex.prompt, '');
    if (ex.hints?.length) {
      lines.push(`### ${isGerman ? 'Hinweise' : 'Hints'}`);
      for (const h of ex.hints) lines.push(`- ${h}`);
      lines.push('');
    }
    if (ex.solution) {
      lines.push(`### ${isGerman ? 'Lösung' : 'Solution'}`);
      lines.push(ex.solution, '');
    }
    if (ex.checkQuestion) {
      lines.push(`**${isGerman ? 'Selbstcheck' : 'Self-check'}:** ${ex.checkQuestion}`, '');
    }
    lines.push('---', '');
  }
  return lines.join('\n').trim();
}

function buildAufgabenPrompt(language, profile, count) {
  const schema = `Return strict JSON only: {"exercises":[{"id":"1","title":"short title","topic":"linked theme","type":"calculation|proof|concept|application","difficulty":"easy|medium|hard","prompt":"markdown problem","hints":["optional hint"],"solution":"markdown worked solution","checkQuestion":"one sentence self-check","sourceNote":"optional: from slide/exercise sheet or invented practice"}]}`;
  const languageRule = `Write every field in ${language}, except exact formulas/symbols from the source.`;
  const base = `${languageRule} ${schema}. Create exactly ${count} exercises grounded ONLY in this lecture.`;
  if (language === 'German') {
    const de = `${base} Wenn die PDF echte Übungsaufgaben enthält, extrahiere und formuliere sie nach; ergänze sonst passende Übungsaufgaben zu den Kernthemen. Jede Aufgabe braucht: klare Aufgabenstellung, 0–2 Hinweise, ausführliche Lösung mit Schritten, Selbstcheck. Keine Organisatorik.`;
    if (profile === 'math_stats') {
      return `${de} ${mathFormattingRules()} Bevorzuge Rechenaufgaben, Beweise und Konzeptfragen mit echten Zahlen/Notation aus der Vorlesung.`;
    }
    return de;
  }
  if (profile === 'math_stats') {
    return `${base} ${mathFormattingRules()} Prefer calculation, proof, and concept checks with notation from the lecture.`;
  }
  if (profile === 'programming') {
    return `${base} Prefer coding tasks: trace output, fix a bug, complete a function, explain a short snippet from the lecture. Solutions must include fenced code blocks.`;
  }
  return `${base} If the PDF contains explicit exercises, extract them; otherwise invent appropriate practice for the core themes. Each item needs prompt, hints, worked solution, and self-check.`;
}

async function generateAufgabenBundle({
  openai,
  model,
  lecturePath,
  courseName = '',
  meta = {},
  overview = '',
  summary = '',
  concepts = '',
  extracted = '',
  lectureStructure = null
}) {
  const structure = lectureStructure || buildLectureStructure({
    courseName: courseName || meta.course || '',
    lecturePath,
    meta,
    overview,
    summary,
    concepts,
    extracted
  });
  const threadContext = buildLectureThreadContextFromMaterials(lecturePath, { overview, summary, concepts, extracted, lectureStructure: structure });
  const content = [
    formatLectureStructureForPrompt(structure),
    threadContext.markdown,
    overview,
    summary,
    concepts,
    extracted.slice(0, 28000)
  ].join('\n\n').trim();
  if (!content) return { success: false, error: 'No lecture content available' };
  const outputLanguage = meta.outputLanguage || readLectureLanguage(lecturePath, content);
  const lectureProfile = meta.lectureProfile || readLectureProfile(lecturePath, content);
  const count = lectureProfile === 'math_stats' ? 6 : 5;
  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: buildAufgabenPrompt(outputLanguage, lectureProfile, count) },
      { role: 'user', content: `Course: ${courseName || meta.course || ''}\nLecture: ${meta.inferredLectureName || ''}\n\nMaterials:\n${content}` }
    ],
    temperature: getTemperature(0.35)
  });
  const parsed = parseQuizJson(response.choices?.[0]?.message?.content || '');
  const aufgaben = normalizeAufgaben(parsed, { language: outputLanguage, count });
  if (!aufgaben.exercises.length) return { success: false, error: 'Model returned no valid exercises' };
  const markdown = buildAufgabenMarkdown(aufgaben);
  return {
    success: true,
    aufgaben,
    markdown,
    tokens: response.usage?.total_tokens || 0
  };
}

function writeAufgabenFiles(lecturePath, aufgaben, markdown) {
  fs.writeFileSync(path.join(lecturePath, 'aufgaben.json'), JSON.stringify(aufgaben, null, 2), 'utf8');
  fs.writeFileSync(path.join(lecturePath, 'aufgaben.md'), markdown || buildAufgabenMarkdown(aufgaben), 'utf8');
}

function buildInteractiveQuizPrompt(language, profile, count, difficulty) {
  const schema = 'Return strict JSON only: {"questions":[{"id":"q1","prompt":"...","options":["...","...","...","..."],"correctIndex":0,"explanation":"...","weakPoint":"..."}]}';
  const languageRule = `Write every prompt, option, explanation, and weakPoint in ${language}, except exact source terms/formulas.`;
  if (profile === 'math_stats') {
    return `${languageRule} ${mathFormattingRules()} ${schema}. Create exactly ${count} interactive multiple-choice questions at ${difficulty} difficulty. Make them method-aware and step-aware: notation meaning, procedure order, assumptions, interpretation, and common calculation traps. Each explanation must say why the correct answer is right and what weak point a wrong answer reveals.`;
  }
  return `${languageRule} ${schema}. Create exactly ${count} active-recall multiple-choice questions for ${difficulty} difficulty. Test concept connections, distinctions, implications, prerequisites, thread position, and common misunderstandings grounded in THIS lecture only. Each explanation must be useful feedback, not just the answer.`;
}
