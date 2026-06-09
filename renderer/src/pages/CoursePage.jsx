import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import LectureMarkdown from '../components/LectureMarkdown';
import LectureStructureOverview from '../components/LectureStructureOverview';
import LectureNotesPanel from '../components/LectureNotesPanel';
import InteractiveQuizPanel from '../components/InteractiveQuizPanel';
import DeepDivePanel from '../components/DeepDivePanel';
import AufgabenPanel from '../components/AufgabenPanel';
import CourseStudyHome from '../components/CourseStudyHome';
import { getDeepDiveTopicSections, getCourseSequence, slugifyTopic, isGermanLecture } from '../utils/lectureStructure';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'summary', label: 'Summary' },
  { id: 'concepts', label: 'Concepts' },
  { id: 'aufgaben', label: 'Aufgaben' },
  { id: 'quiz', label: 'Quiz' },
  { id: 'deepDive', label: 'Deep Dive' },
  { id: 'notes', label: 'Notes' },
];

export default function CoursePage({
  course,
  processedLecture,
  onClearProcessed,
  onDropFiles,
  state,
  openRequest,
  onOpenRequestHandled,
  onBackToDashboard,
}) {
  const [lectures, setLectures] = useState([]);
  const [selectedLecture, setSelectedLecture] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [localDragging, setLocalDragging] = useState(false);
  const [overviewLoading, setOverviewLoading] = useState(false);

  const [deepDiveTopic, setDeepDiveTopic] = useState('');
  const [deepDiveMode, setDeepDiveMode] = useState('explain');
  const [deepDiveMarkdown, setDeepDiveMarkdown] = useState('');
  const [deepDiveSlug, setDeepDiveSlug] = useState('');
  const [deepDiveLoading, setDeepDiveLoading] = useState(false);
  const [subtopic, setSubtopic] = useState('');
  const [subtopicMarkdown, setSubtopicMarkdown] = useState('');
  const [customTopic, setCustomTopic] = useState('');

  const [topicQuizData, setTopicQuizData] = useState(null);
  const [quizAnswers, setQuizAnswers] = useState({});
  const [quizChecked, setQuizChecked] = useState(false);
  const [quizAttempts, setQuizAttempts] = useState([]);

  const [askDraft, setAskDraft] = useState('');
  const [askAnswer, setAskAnswer] = useState('');
  const [askLoading, setAskLoading] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const askInputRef = useRef(null);
  const [readingOpen, setReadingOpen] = useState(false);
  const [markingDone, setMarkingDone] = useState(false);
  const [aufgabenLoading, setAufgabenLoading] = useState(false);
  const [noteCards, setNoteCards] = useState([]);
  const [deepStudy, setDeepStudy] = useState(null);
  const [deepStudyCoverage, setDeepStudyCoverage] = useState(null);
  const [deepSuggestions, setDeepSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [saveToast, setSaveToast] = useState('');

  const exploredSet = useMemo(() => {
    const set = new Set();
    for (const e of deepStudy?.explored || []) {
      const t = `${String(e.topic || '').toLowerCase().trim()}::${String(e.subtopic || '').toLowerCase().trim()}`;
      set.add(t);
    }
    return set;
  }, [deepStudy?.explored]);

  const lectureDeepComplete = !!(deepStudy?.complete);

  const deepDiveTopicSections = useMemo(
    () => getDeepDiveTopicSections(selectedLecture),
    [selectedLecture?.id, selectedLecture?.lectureStructure]
  );
  const quizScore = useMemo(() => calculateQuizScore(topicQuizData, quizAnswers, quizChecked), [topicQuizData, quizAnswers, quizChecked]);

  const sequencedLectures = useMemo(() =>
    [...lectures].sort((a, b) => {
      const ai = getCourseSequence(a)?.index ?? a.threadContext?.sequenceIndex ?? 999;
      const bi = getCourseSequence(b)?.index ?? b.threadContext?.sequenceIndex ?? 999;
      if (ai !== bi) return ai - bi;
      const ta = a.meta?.processedAt ? new Date(a.meta.processedAt).getTime() : 0;
      const tb = b.meta?.processedAt ? new Date(b.meta.processedAt).getTime() : 0;
      return ta - tb;
    }), [lectures]);

  const lectureSequence = useMemo(() => {
    if (!selectedLecture) return { index: -1, prev: null, next: null, total: 0 };
    const idx = sequencedLectures.findIndex((l) => l.id === selectedLecture.id);
    const seq = getCourseSequence(selectedLecture);
    return {
      index: idx,
      sequenceIndex: seq?.index ?? (idx >= 0 ? idx + 1 : 0),
      sequenceLabel: seq?.label || (idx >= 0 ? `Lecture ${idx + 1}` : ''),
      total: sequencedLectures.length,
      prev: idx > 0 ? sequencedLectures[idx - 1] : null,
      next: idx >= 0 && idx < sequencedLectures.length - 1 ? sequencedLectures[idx + 1] : null,
    };
  }, [selectedLecture, sequencedLectures]);

  const loadLectures = useCallback(async () => {
    setLoading(true);
    try {
      const result = await Promise.race([
        window.api.getLectures(course.name),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Loading lectures timed out')), 45000)),
      ]);
      setLectures(Array.isArray(result) ? result : []);
    } catch (err) {
      console.error('getLectures failed:', err);
      setLectures([]);
    } finally {
      setLoading(false);
    }
  }, [course.name]);

  const loadLectureDetails = useCallback(async (lec) => {
    if (!lec?.path) return lec;
    try {
      const res = await window.api.getLectureDetails({ lecturePath: lec.path, courseName: course.name });
      if (!res?.success) return lec;
      const { success, displayName, ...details } = res;
      const name = displayName || details.meta?.inferredLectureName || lec.name;
      return {
        ...lec,
        ...details,
        name,
        meta: { ...details.meta, inferredLectureName: name },
        aufgaben: details.aufgaben,
        aufgabenProgress: details.aufgabenProgress,
        noteCards: details.noteCards || [],
        deepStudy: details.deepStudy || null,
        deepStudyCoverage: details.deepStudyCoverage || null,
      };
    } catch (err) {
      console.error('getLectureDetails failed:', err);
      return lec;
    }
  }, [course.name]);

  useEffect(() => {
    loadLectures();
    setSelectedLecture(null);
  }, [course.id, loadLectures]);

  const resetLectureSession = useCallback(() => {
    setDeepDiveMarkdown('');
    setDeepDiveSlug('');
    setSubtopic('');
    setSubtopicMarkdown('');
    setCustomTopic('');
    setTopicQuizData(null);
    setQuizAnswers({});
    setQuizChecked(false);
    setQuizAttempts([]);
    setAskDraft('');
    setAskAnswer('');
    setAskOpen(false);
    setDeepSuggestions([]);
    setDeepStudy(null);
    setDeepStudyCoverage(null);
  }, []);

  const syncDeepStudyState = useCallback((ds, coverage) => {
    if (ds) setDeepStudy(ds);
    if (coverage) setDeepStudyCoverage(coverage);
    else if (ds) {
      setDeepStudyCoverage({
        ratio: ds.complete ? 1 : 0,
        complete: !!ds.complete,
      });
    }
    if (ds?.complete) {
      setDeepSuggestions([]);
    } else if (ds?.lastSuggestions?.length) {
      setDeepSuggestions(ds.lastSuggestions);
    }
  }, []);

  const refreshDeepSuggestions = useCallback(async (opts = {}) => {
    if (!selectedLecture?.path) return;
    setSuggestionsLoading(true);
    const res = await window.api.suggestDeepSteps({
      lecturePath: selectedLecture.path,
      parentTopic: opts.parentTopic || '',
      currentTopic: opts.currentTopic || deepDiveTopic || customTopic,
      currentSubtopic: opts.currentSubtopic || subtopic,
      deepDiveExcerpt: opts.deepDiveExcerpt ?? deepDiveMarkdown,
      subtopicExcerpt: opts.subtopicExcerpt ?? subtopicMarkdown,
    });
    setSuggestionsLoading(false);
    if (!res?.success) return;
    if (res.coverage) setDeepStudyCoverage(res.coverage);
    if (res.deepStudy) {
      syncDeepStudyState(res.deepStudy, res.coverage);
      setSelectedLecture((p) => (p ? { ...p, deepStudy: res.deepStudy, deepStudyCoverage: res.coverage } : p));
    }
    else if (res.complete) {
      setDeepStudy((prev) => ({
        ...(prev || {}),
        complete: true,
        completeReason: res.completeMessage,
        lastSuggestions: [],
      }));
    }
    setDeepSuggestions(res.complete ? [] : (res.suggestions || []));
    if (res.complete && res.completeMessage) {
      setSelectedLecture((p) => (p ? {
        ...p,
        deepStudy: { ...(p.deepStudy || {}), complete: true, completeReason: res.completeMessage },
      } : p));
    }
  }, [selectedLecture?.path, deepDiveTopic, customTopic, subtopic, deepDiveMarkdown, subtopicMarkdown, syncDeepStudyState]);

  useEffect(() => {
    if (!selectedLecture?.path) return;
    window.api.trackLectureActivity({ lecturePath: selectedLecture.path, eventType: 'opened' });
    resetLectureSession();
    const sections = getDeepDiveTopicSections(selectedLecture);
    const first = sections[0];
    const initial = first?.subtopics?.[0]?.label || first?.label || '';
    setDeepDiveTopic(initial);
    setNoteCards(selectedLecture.noteCards || []);
    setDeepStudy(selectedLecture.deepStudy || null);
    setDeepStudyCoverage(selectedLecture.deepStudyCoverage || null);
    setDeepSuggestions(selectedLecture.deepStudy?.lastSuggestions || []);
  }, [selectedLecture?.id, resetLectureSession]);

  useEffect(() => {
    if (!selectedLecture?.path || !activeTab) return;
    window.api.trackLectureActivity({
      lecturePath: selectedLecture.path,
      eventType: 'tab_view',
      payload: { tab: activeTab },
    });
  }, [activeTab, selectedLecture?.id]);

  useEffect(() => {
    if (!processedLecture || processedLecture.course?.id !== course.id) return;

    if (processedLecture.batchImport) {
      loadLectures().then(() => {
        const last = processedLecture.lastLecture;
        if (last?.lectureDir) {
          const lec = {
            id: last.lectureId,
            name: last.lectureName,
            path: last.lectureDir,
            meta: last.meta,
            summary: last.summary,
            concepts: last.concepts,
            overview: last.overview,
            quiz: last.quiz,
            lectureStructure: last.lectureStructure,
            notes: '',
          };
          loadLectureDetails(lec).then((full) => {
            setSelectedLecture(full);
            setActiveTab('overview');
          });
        }
        onClearProcessed();
      });
      return;
    }

    loadLectures().then(async () => {
      const lec = {
        id: processedLecture.lectureId,
        name: processedLecture.lectureName,
        path: processedLecture.lectureDir,
        meta: processedLecture.meta,
        summary: processedLecture.summary,
        concepts: processedLecture.concepts,
        overview: processedLecture.overview,
        quiz: processedLecture.quiz,
        lectureStructure: processedLecture.lectureStructure,
        notes: '',
      };
      setSelectedLecture(lec);
      setActiveTab('overview');
      onClearProcessed();
      const full = await loadLectureDetails(lec);
      setSelectedLecture(full);
    });
  }, [processedLecture, course.id, loadLectures, loadLectureDetails, onClearProcessed]);

  useEffect(() => {
    if (!readingOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setReadingOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [readingOpen]);

  const loadCachedDeepDive = async (topic, lecturePath, mode = 'explain') => {
    const slug = slugifyTopic(topic);
    const modePath = `${lecturePath}/deep_dives/${slug}__${mode}.md`;
    const legacyPath = `${lecturePath}/deep_dives/${slug}.md`;
    let content = await window.api.readFile(modePath);
    if (!content?.trim() && mode !== 'explain') content = await window.api.readFile(legacyPath);
    if (!content?.trim() && mode === 'explain') content = await window.api.readFile(legacyPath);
    if (content?.trim()) {
      setDeepDiveMarkdown(content);
      setDeepDiveSlug(slug);
      const quizRes = await window.api.loadTopicQuiz({ lecturePath, topicSlug: slug, difficulty: 'medium' });
      if (quizRes?.success) {
        setTopicQuizData(quizRes.quiz);
        setQuizAttempts(quizRes.attempts || []);
      }
      return true;
    }
    return false;
  };

  useEffect(() => {
    if (!selectedLecture?.path || !deepDiveTopic || activeTab !== 'deepDive') return;
    loadCachedDeepDive(deepDiveTopic, selectedLecture.path, deepDiveMode);
  }, [deepDiveTopic, deepDiveMode, selectedLecture?.path, activeTab]);

  const handleLocalDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setLocalDragging(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => f.name.toLowerCase().endsWith('.pdf'));
    if (files.length > 0) {
      onDropFiles(files.map((f) => ({ name: f.name, path: f.path })), { preferredCourse: course });
    }
  };

  const navigateLecture = useCallback(async (lec, options = {}) => {
    setSelectedLecture({ ...lec, _detailsLoading: true });
    setActiveTab(options.tab || 'overview');
    const full = await loadLectureDetails(lec);
    setSelectedLecture(full);
    if (options.tab) setActiveTab(options.tab);
    return full;
  }, [loadLectureDetails]);

  useEffect(() => {
    if (!openRequest || openRequest.courseId !== course.id || loading) return;

    const match = lectures.find((l) => {
      if (openRequest.lecturePath && l.path === openRequest.lecturePath) return true;
      if (openRequest.lectureId && l.id === openRequest.lectureId) return true;
      return false;
    });

    const target = match || (openRequest.lecturePath ? {
      id: openRequest.lectureId || openRequest.lecturePath.split('/').pop(),
      path: openRequest.lecturePath,
      name: openRequest.lectureName || openRequest.lectureId || 'Lecture',
    } : null);

    if (!target) {
      onOpenRequestHandled?.();
      return;
    }

    navigateLecture(target, { tab: openRequest.tab }).then(() => {
      onOpenRequestHandled?.();
    });
  }, [openRequest?.nonce, loading, lectures, course.id, navigateLecture, onOpenRequestHandled]);

  const generateQuickOverview = async () => {
    if (!selectedLecture?.path) return;
    setOverviewLoading(true);
    const result = await window.api.generateLectureOverview({ lecturePath: selectedLecture.path });
    if (result.success) {
      setSelectedLecture((prev) => ({ ...prev, overview: result.overview }));
      await loadLectures();
    }
    setOverviewLoading(false);
  };

  const generateAufgaben = async () => {
    if (!selectedLecture?.path) return;
    setAufgabenLoading(true);
    const result = await window.api.generateAufgaben({ lecturePath: selectedLecture.path });
    if (result.success) {
      setSelectedLecture((prev) => ({ ...prev, aufgaben: result.aufgaben }));
    }
    setAufgabenLoading(false);
  };

  const headerRegenerate = () => {
    if (activeTab === 'aufgaben') return generateAufgaben();
    return generateQuickOverview();
  };

  const headerRegenerateLabel = () => {
    if (overviewLoading || aufgabenLoading) return '…';
    if (activeTab === 'aufgaben') return isGermanLecture(selectedLecture) ? 'Aufgaben neu' : 'Regenerate';
    return 'Regenerate';
  };

  const startStudyUnit = async (lec, unit, step) => {
    const targetTab = step?.tab || 'overview';
    await navigateLecture(lec, { tab: targetTab });
    if (step?.tab === 'deepDive' && unit?.label) {
      setDeepDiveTopic(unit.label);
      setCustomTopic('');
      setDeepDiveMode(step.mode || 'explain');
      setActiveTab('deepDive');
    } else if (step?.tab) {
      setActiveTab(step.tab);
    } else if (unit?.label) {
      setDeepDiveTopic(unit.label);
      setActiveTab('overview');
    } else {
      setActiveTab('overview');
    }
  };

  const handleStudyStep = (unit, step) => {
    if (!selectedLecture) return;
    startStudyUnit(selectedLecture, unit, step);
  };

  const showSaveToast = (msg) => {
    setSaveToast(msg);
    setTimeout(() => setSaveToast(''), 2800);
  };

  const saveToNotes = async ({ markdown, type, title, topic, parentTopic, mode }) => {
    if (!selectedLecture?.path || !markdown?.trim()) return;
    const res = await window.api.saveNoteCard({
      lecturePath: selectedLecture.path,
      type,
      title,
      topic,
      parentTopic,
      mode,
      markdown,
      bookmarked: true,
    });
    if (res?.success) {
      setNoteCards(res.cards || []);
      showSaveToast(isGermanLecture(selectedLecture) ? 'In Notes gespeichert' : 'Saved to Notes');
    }
  };

  const generateTopicDeepDive = async () => {
    const topic = customTopic.trim() || deepDiveTopic;
    if (!selectedLecture?.path || !topic) return;
    setDeepDiveLoading(true);
    setDeepSuggestions([]);
    const cached = await loadCachedDeepDive(topic, selectedLecture.path, deepDiveMode);
    if (!cached) {
      const result = await window.api.generateDeepDive({
        lecturePath: selectedLecture.path,
        topic,
        mode: deepDiveMode,
      });
      if (result.success) {
        setDeepDiveMarkdown(result.deepDive);
        setDeepDiveSlug(result.slug);
        setTopicQuizData(null);
        setQuizAnswers({});
        setQuizChecked(false);
        if (result.deepStudy) syncDeepStudyState(result.deepStudy);
      }
    }
    setSubtopic('');
    setSubtopicMarkdown('');
    const excerpt = cached || deepDiveMarkdown;
    setDeepDiveLoading(false);
    await refreshDeepSuggestions({
      currentTopic: topic,
      deepDiveExcerpt: excerpt,
      subtopicExcerpt: '',
    });
  };

  const generateSubtopicDeepDive = async () => {
    if (!selectedLecture?.path || !deepDiveSlug || !subtopic.trim()) return;
    setDeepDiveLoading(true);
    const result = await window.api.generateSubtopicDive({
      lecturePath: selectedLecture.path,
      topicSlug: deepDiveSlug,
      subtopic: subtopic.trim(),
      parentTopic: deepDiveTopic || customTopic,
    });
    if (result.success) {
      setSubtopicMarkdown(result.subtopicDive);
      if (result.deepStudy) syncDeepStudyState(result.deepStudy);
    }
    setDeepDiveLoading(false);
    if (result.success) {
      await refreshDeepSuggestions({
        parentTopic: result.parentTopic || deepDiveTopic,
        currentTopic: deepDiveTopic || customTopic,
        currentSubtopic: subtopic.trim(),
        deepDiveExcerpt: deepDiveMarkdown,
        subtopicExcerpt: result.subtopicDive,
      });
    }
  };

  const handlePickSuggestion = (s) => {
    if (!s?.label) return;
    setDeepDiveTopic(s.label);
    setCustomTopic('');
    setSubtopic(s.label);
    setSubtopicMarkdown('');
    setDeepDiveMarkdown('');
  };

  const generateTopicQuiz = async () => {
    if (!selectedLecture?.path || !deepDiveSlug) return;
    setDeepDiveLoading(true);
    const result = await window.api.generateTopicQuiz({
      lecturePath: selectedLecture.path,
      topicSlug: deepDiveSlug,
      difficulty: 'medium',
      questionCount: 5,
    });
    if (result.success) {
      setTopicQuizData(result.quiz);
      setQuizAnswers({});
      setQuizChecked(false);
    }
    setDeepDiveLoading(false);
  };

  const handleCheckAll = () => {
    setQuizChecked(true);
    if (!topicQuizData?.questions?.length) return;
    const allAnswered = topicQuizData.questions.every((q) => quizAnswers[q.id]?.selectedIndex !== undefined);
    if (!allAnswered) return;
    persistQuizCheck(quizAnswers);
  };

  const persistQuizCheck = async (nextAnswers) => {
    if (!selectedLecture?.path || !deepDiveSlug) return;
    const score = calculateQuizScore(topicQuizData, nextAnswers, true);
    const result = await window.api.saveQuizAttempt({
      lecturePath: selectedLecture.path,
      topicSlug: deepDiveSlug,
      difficulty: 'medium',
      answers: nextAnswers,
      score,
    });
    if (result.success) setQuizAttempts((prev) => [result.attempt, ...prev].slice(0, 5));
  };

  const submitAskQuick = async () => {
    const q = askDraft.trim();
    if (!selectedLecture?.path || !q) return;
    setAskLoading(true);
    setAskAnswer('');
    const result = await window.api.askLectureQuick({
      lecturePath: selectedLecture.path,
      question: q,
      activeTab,
      courseName: course.name,
      lectureTitle: selectedLecture.name,
    });
    setAskAnswer(result.success ? result.answer : `*${result.error || 'Could not answer'}*`);
    if (result.deepStudy) syncDeepStudyState(result.deepStudy);
    setAskLoading(false);
    if (result.success && deepDiveMarkdown) {
      refreshDeepSuggestions({ currentSubtopic: subtopic });
    }
  };

  const toggleMarkDone = async () => {
    if (!selectedLecture?.path) return;
    setMarkingDone(true);
    const done = selectedLecture.meta?.plannerStatus !== 'done';
    await window.api.markLectureDone({ lecturePath: selectedLecture.path, done });
    await loadLectures();
    setSelectedLecture((prev) => ({
      ...prev,
      meta: { ...prev.meta, plannerStatus: done ? 'done' : 'active' },
      inferredProgress: done ? 'done' : 'active',
    }));
    setMarkingDone(false);
  };

  const handleDeleteLecture = async () => {
    if (!selectedLecture?.path) return;
    const ok = window.confirm(`Delete "${selectedLecture.name}" and all generated materials?`);
    if (!ok) return;
    const result = await window.api.deleteLecture({ lecturePath: selectedLecture.path });
    if (result?.success) {
      setSelectedLecture(null);
      await loadLectures();
    } else {
      window.alert(result?.error || 'Could not delete lecture folder from vault.');
    }
  };

  const progressDot = (progress) => {
    if (progress === 'done') return 'bg-green-400';
    if (progress === 'active' || progress === 'started') return 'bg-accent';
    return 'bg-text-muted/40';
  };

  const readingMarkdown = useMemo(
    () => buildReadingMarkdown(activeTab, selectedLecture, deepDiveMarkdown, subtopicMarkdown),
    [activeTab, selectedLecture, deepDiveMarkdown, subtopicMarkdown]
  );

  if (!course?.name) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-text-muted p-6">
        Course data is missing — pick another course or restart the app.
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col bg-bg-primary overflow-hidden">
      <div className="h-8 drag-region flex-shrink-0" />
      <div className="flex-1 flex overflow-hidden no-drag">
        <aside className="w-52 flex-shrink-0 border-r border-border-subtle flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-border-subtle space-y-2">
            {onBackToDashboard && (
              <button
                type="button"
                onClick={onBackToDashboard}
                className="w-full flex items-center gap-1.5 text-[11px] text-text-muted hover:text-accent transition-colors py-1"
              >
                <span aria-hidden>←</span>
                <span>Dashboard</span>
              </button>
            )}
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-lg">{course.emoji || '📚'}</span>
              <span className="text-xs font-semibold text-text-primary truncate">{course.name}</span>
            </div>
            <p className="text-[10px] text-text-muted">{lectures.length} lectures</p>
          </div>
          <div className="flex-1 overflow-y-auto py-1.5">
            {loading ? (
              <div className="flex justify-center py-8">
                <div className="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
              </div>
            ) : lectures.length === 0 ? (
              <p className="text-center text-xs text-text-muted py-8 px-3">Drop a PDF below</p>
            ) : (
              sequencedLectures.map((lec) => {
                const seq = getCourseSequence(lec);
                return (
                <button
                  key={lec.id}
                  type="button"
                  onClick={() => navigateLecture(lec)}
                  className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors
                    ${selectedLecture?.id === lec.id ? 'bg-accent/15 text-text-primary' : 'text-text-secondary hover:bg-bg-hover'}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${progressDot(lec.inferredProgress)}`} />
                  {seq?.index != null && (
                    <span className="text-[10px] text-accent font-semibold tabular-nums flex-shrink-0 w-5">
                      {seq.index}
                    </span>
                  )}
                  <span className="text-xs truncate flex-1">{lec.name}</span>
                </button>
                );
              })
            )}
          </div>
          <div
            className={`m-2 border border-dashed rounded-lg p-2.5 text-center transition-colors
              ${localDragging ? 'border-accent bg-accent/10' : 'border-border-DEFAULT text-text-muted hover:border-accent/50'}`}
            onDragOver={(e) => { e.preventDefault(); setLocalDragging(true); }}
            onDragLeave={() => setLocalDragging(false)}
            onDrop={handleLocalDrop}
          >
            <p className="text-[10px] font-medium">Drop PDF(s)</p>
          </div>
        </aside>

        <div className="flex-1 overflow-hidden flex flex-col">
          {!selectedLecture ? (
            <CourseStudyHome
              course={course}
              lectures={lectures}
              loading={loading}
              isGerman={isGermanLecture({ meta: { outputLanguage: course.language } })}
              onSelectLecture={(lec) => navigateLecture(lec)}
              onStartUnit={startStudyUnit}
              onOpenCourseLink={(link) => {
                const target = sequencedLectures.find(
                  (l) => (link.priorLecturePath && l.path === link.priorLecturePath)
                    || (link.priorLectureId && l.id === link.priorLectureId)
                );
                if (target) navigateLecture(target, { tab: link.tab || 'overview' });
              }}
            />
          ) : (
            <>
              <header className="px-4 pt-3 pb-0 border-b border-border-subtle flex-shrink-0">
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button type="button" disabled={!lectureSequence.prev} onClick={() => lectureSequence.prev && navigateLecture(lectureSequence.prev)} className="w-6 h-6 rounded text-sm disabled:opacity-25">←</button>
                    <span className="text-[10px] text-text-muted tabular-nums" title={lectureSequence.sequenceLabel}>
                      {lectureSequence.sequenceLabel || `${lectureSequence.sequenceIndex}/${lectureSequence.total}`}
                    </span>
                    <button type="button" disabled={!lectureSequence.next} onClick={() => lectureSequence.next && navigateLecture(lectureSequence.next)} className="w-6 h-6 rounded text-sm disabled:opacity-25">→</button>
                  </div>
                  <h2 className="text-sm font-semibold truncate flex-1">{selectedLecture.name}</h2>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button type="button" onClick={toggleMarkDone} disabled={markingDone} className="text-[10px] px-2 py-1 rounded border border-border-subtle hover:bg-bg-hover">
                      {selectedLecture.meta?.plannerStatus === 'done' ? 'Undo done' : 'Mark done'}
                    </button>
                    <button
                      type="button"
                      onClick={headerRegenerate}
                      disabled={overviewLoading || aufgabenLoading}
                      className="text-[10px] px-2 py-1 rounded hover:bg-bg-hover"
                    >
                      {headerRegenerateLabel()}
                    </button>
                    <button type="button" onClick={() => setReadingOpen(true)} className="text-[10px] px-2 py-1 rounded border border-border-subtle">Read</button>
                    <button type="button" onClick={() => window.api.openPath(selectedLecture.path)} className="text-[10px] px-2 py-1 rounded border border-border-subtle">Finder</button>
                    <button type="button" onClick={handleDeleteLecture} className="text-[10px] px-2 py-1 rounded text-red-400/80 hover:bg-red-500/10">Delete</button>
                  </div>
                </div>
                <div className="flex gap-0.5 overflow-x-auto">
                  {TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-t-lg whitespace-nowrap
                        ${activeTab === tab.id ? 'bg-bg-primary text-accent border-t border-l border-r border-border-subtle -mb-px' : 'text-text-muted hover:text-text-secondary'}`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </header>

              <div className="flex-1 overflow-hidden flex flex-col min-h-0">
                <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
                  {selectedLecture._detailsLoading && (
                    <p className="text-xs text-text-muted mb-3">Loading lecture content…</p>
                  )}
                  <div className="markdown-body max-w-3xl">
                    {activeTab === 'overview' && (
                      <LectureStructureOverview
                        lecture={selectedLecture}
                        lectures={sequencedLectures}
                        onStudyStep={handleStudyStep}
                        onOpenLecture={(lec, opts) => navigateLecture(lec, opts)}
                      />
                    )}
                    {activeTab === 'summary' && (
                      <LectureMarkdown>{selectedLecture.summary || '*No summary.*'}</LectureMarkdown>
                    )}
                    {activeTab === 'concepts' && (
                      <LectureMarkdown>{selectedLecture.concepts || '*No concepts.*'}</LectureMarkdown>
                    )}
                    {activeTab === 'aufgaben' && (
                      <AufgabenPanel
                        lecturePath={selectedLecture.path}
                        initialAufgaben={selectedLecture.aufgaben}
                        initialProgress={selectedLecture.aufgabenProgress}
                        isGerman={isGermanLecture(selectedLecture)}
                        onAufgabenUpdated={(aufgaben) => setSelectedLecture((p) => ({ ...p, aufgaben }))}
                      />
                    )}
                    {activeTab === 'quiz' && (
                      <InteractiveQuizPanel
                        lecturePath={selectedLecture.path}
                        lectureProfile={selectedLecture.meta?.lectureProfile}
                      />
                    )}
                    {activeTab === 'deepDive' && (
                      <DeepDivePanel
                        lecture={selectedLecture}
                        topicSections={deepDiveTopicSections}
                        selectedTopic={deepDiveTopic}
                        onSelectTopic={(t) => { setDeepDiveTopic(t); setDeepDiveMarkdown(''); }}
                        customTopic={customTopic}
                        onCustomTopicChange={setCustomTopic}
                        deepDiveMode={deepDiveMode}
                        onDeepDiveModeChange={(m) => { setDeepDiveMode(m); setDeepDiveMarkdown(''); }}
                        deepDiveMarkdown={deepDiveMarkdown}
                        deepDiveSlug={deepDiveSlug}
                        deepDiveLoading={deepDiveLoading}
                        subtopic={subtopic}
                        onSubtopicChange={setSubtopic}
                        subtopicMarkdown={subtopicMarkdown}
                        topicQuizData={topicQuizData}
                        quizAnswers={quizAnswers}
                        onQuizAnswersChange={setQuizAnswers}
                        quizChecked={quizChecked}
                        quizScore={quizScore}
                        quizAttempts={quizAttempts}
                        onGenerate={generateTopicDeepDive}
                        onSubtopicDive={generateSubtopicDeepDive}
                        onGenerateQuiz={generateTopicQuiz}
                        onCheckAll={handleCheckAll}
                        onResetQuiz={() => { setQuizAnswers({}); setQuizChecked(false); }}
                        onSaveDeepDive={() => saveToNotes({
                          markdown: deepDiveMarkdown,
                          type: 'deep_dive',
                          title: `${deepDiveTopic || customTopic} (${deepDiveMode})`,
                          topic: customTopic.trim() || deepDiveTopic,
                          parentTopic: '',
                          mode: deepDiveMode,
                        })}
                        onSaveSubtopic={() => saveToNotes({
                          markdown: subtopicMarkdown,
                          type: 'subtopic',
                          title: subtopic.trim(),
                          topic: subtopic.trim(),
                          parentTopic: deepDiveTopic || customTopic,
                          mode: 'subtopic',
                        })}
                        onPickSuggestion={handlePickSuggestion}
                        deepSuggestions={deepSuggestions}
                        suggestionsLoading={suggestionsLoading}
                        lectureComplete={lectureDeepComplete}
                        completeMessage={deepStudy?.completeReason || ''}
                        deepStudyCoverage={deepStudyCoverage}
                        exploredSet={exploredSet}
                        isGerman={isGermanLecture(selectedLecture)}
                        lectureProfile={
                          selectedLecture?.meta?.lectureProfile
                          || (course?.courseType === 'programming' ? 'programming'
                            : course?.courseType === 'math' || course?.courseType === 'statistics' ? 'math_stats'
                              : course?.courseType === 'psychology' ? 'psychology'
                                : '')
                          || 'conceptual'
                        }
                      />
                    )}
                    {activeTab === 'notes' && (
                      <LectureNotesPanel
                        lecturePath={selectedLecture.path}
                        courseName={course.name}
                        lectureTitle={selectedLecture.name}
                        initialNotes={selectedLecture.notes}
                        initialStudyCard={selectedLecture.studyCard}
                        initialNoteCards={noteCards}
                        onSaved={(text) => setSelectedLecture((p) => ({ ...p, notes: text }))}
                        onCardGenerated={(card) => setSelectedLecture((p) => ({ ...p, studyCard: card }))}
                        onCardsChange={(cards) => {
                          setNoteCards(cards);
                          setSelectedLecture((p) => (p ? { ...p, noteCards: cards } : p));
                        }}
                      />
                    )}
                  </div>
                </div>

                {saveToast && (
                  <div className="flex-shrink-0 px-4 py-1.5 bg-green-500/15 border-t border-green-500/30 text-center text-xs text-green-400">
                    {saveToast}
                  </div>
                )}
                <div className="flex-shrink-0 border-t border-border-subtle bg-bg-secondary">
                  {askOpen && askAnswer && (
                    <div className="px-4 pt-3 pb-2 max-h-40 overflow-y-auto border-b border-border-subtle">
                      <LectureMarkdown>{askAnswer}</LectureMarkdown>
                    </div>
                  )}
                  <div className="px-3 py-2 flex items-center gap-2">
                    <span className="text-xs text-text-muted flex-shrink-0">Ask</span>
                    <input
                      ref={askInputRef}
                      type="text"
                      value={askDraft}
                      onChange={(e) => setAskDraft(e.target.value)}
                      onFocus={() => setAskOpen(true)}
                      onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && submitAskQuick()}
                      placeholder="What should I understand first? How does X connect to Y?"
                      className="flex-1 min-w-0 bg-bg-tertiary border border-border-DEFAULT rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-accent"
                    />
                    <button type="button" onClick={submitAskQuick} disabled={askLoading || !askDraft.trim()} className="px-3 py-1.5 rounded-lg bg-accent text-white text-sm disabled:opacity-40">
                      {askLoading ? '…' : '↑'}
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {readingOpen && selectedLecture && (
        <div className="fixed inset-0 z-[60] flex p-4 sm:p-8 no-drag">
          <button type="button" aria-label="Close" className="absolute inset-0 bg-black/75" onClick={() => setReadingOpen(false)} />
          <div className="relative z-[61] flex flex-col w-full max-w-4xl max-h-[92vh] mx-auto rounded-2xl border border-border-DEFAULT bg-bg-secondary overflow-hidden">
            <div className="flex justify-between px-4 py-3 border-b border-border-subtle">
              <h3 className="text-sm font-semibold truncate">{tabLabel(activeTab)} — {selectedLecture.name}</h3>
              <button type="button" onClick={() => setReadingOpen(false)} className="text-sm px-3 py-1 border rounded-lg">Close</button>
            </div>
            <div className="flex-1 overflow-y-auto px-8 py-6 markdown-body markdown-body-reading">
              <LectureMarkdown>{readingMarkdown.trim() || '*Nothing yet.*'}</LectureMarkdown>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function tabLabel(tab) {
  return TABS.find((t) => t.id === tab)?.label || tab;
}

function buildReadingMarkdown(activeTab, lecture, deepDiveMarkdown, subtopicMarkdown) {
  if (!lecture) return '';
  if (activeTab === 'overview') return lecture.overview || '';
  if (activeTab === 'summary') return lecture.summary || '';
  if (activeTab === 'concepts') return lecture.concepts || '';
  if (activeTab === 'aufgaben') {
    const parts = (lecture.aufgaben?.exercises || []).map((ex) => {
      return [`## ${ex.title}`, '', ex.prompt, '', ex.solution ? `### Solution\n${ex.solution}` : ''].filter(Boolean).join('\n');
    });
    return parts.join('\n\n---\n\n') || '';
  }
  if (activeTab === 'notes') return lecture.notes || '';
  if (activeTab === 'deepDive') {
    return [deepDiveMarkdown, subtopicMarkdown].filter(Boolean).join('\n\n---\n\n');
  }
  return '';
}

function calculateQuizScore(topicQuizData, quizAnswers, checked) {
  const questions = topicQuizData?.questions || [];
  let correct = 0;
  for (const q of questions) {
    const sel = quizAnswers[q.id]?.selectedIndex;
    if (sel !== undefined && checked && sel === q.correctIndex) correct += 1;
  }
  return { total: questions.length, correct };
}
