import React, { useState, useCallback, useRef } from 'react';
import { useStore } from './hooks/useStore';
import { useDropZone } from './hooks/useDropZone';
import Onboarding from './pages/Onboarding';
import MainLayout from './pages/MainLayout';
import ProcessingModal from './components/ProcessingModal';
import CourseSelectModal from './components/CourseSelectModal';

export default function App() {
  const { state, loading, update, refresh } = useStore();
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [droppedFiles, setDroppedFiles] = useState([]);
  const [intakeKey, setIntakeKey] = useState(0);
  const [showCourseSelect, setShowCourseSelect] = useState(false);
  const [placementSuggestion, setPlacementSuggestion] = useState(null);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [preferredCourse, setPreferredCourse] = useState(null);
  const [processing, setProcessing] = useState(null);
  const [processedLecture, setProcessedLecture] = useState(null);
  const [lectureOpenRequest, setLectureOpenRequest] = useState(null);
  const [confirmingIntake, setConfirmingIntake] = useState(false);

  const pendingFilesRef = useRef([]);
  const confirmInFlightRef = useRef(false);
  const processingActiveRef = useRef(false);
  const batchAbortRef = useRef(false);
  const batchGateRef = useRef(null);
  const batchRetryOkRef = useRef(null);

  const runProcessing = useCallback(async (file, course, batchMeta = null) => {
    if (!file?.path || !course?.id) return { success: false, error: 'INVALID_INPUT', message: 'Missing file or course.' };

    processingActiveRef.current = true;
    setProcessing({
      file,
      course,
      status: { step: 'starting', message: 'Starting…' },
      error: null,
      batch: batchMeta,
    });

    const removeListener = window.api.onProcessingStatus((status) => {
      setProcessing((prev) => (prev ? { ...prev, status } : null));
    });

    try {
      return await window.api.processPDF({
        pdfPath: file.path,
        courseId: course.id,
        courseName: course.name,
      });
    } catch (err) {
      return { success: false, error: 'UNKNOWN_ERROR', message: err.message };
    } finally {
      removeListener();
      processingActiveRef.current = false;
    }
  }, []);

  const waitForBatchDecision = () =>
    new Promise((resolve) => {
      batchGateRef.current = resolve;
    });

  const resolveBatchGate = (action) => {
    if (batchGateRef.current) {
      batchGateRef.current(action);
      batchGateRef.current = null;
    }
  };

  const dedupePdfFiles = useCallback((files) => {
    const seen = new Set();
    const out = [];
    for (const f of files || []) {
      const key = (f.path || f.name || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(f);
    }
    return out;
  }, []);

  const runBatchProcessing = useCallback(async (files, course) => {
    const uniqueFiles = dedupePdfFiles(files);
    const batch = {
      total: uniqueFiles.length,
      current: 1,
      files: uniqueFiles,
      completed: [],
      skipped: [],
      failed: [],
      finished: false,
    };
    let lastSuccess = null;

    for (let i = 0; i < uniqueFiles.length; i++) {
      if (batchAbortRef.current) break;

      const file = uniqueFiles[i];
      batch.current = i + 1;

      const result = await runProcessing(file, course, { ...batch });

      if (result?.success) {
        if (result.skipped) {
          batch.skipped.push({
            name: file.name,
            lectureName: result.lectureName,
            message: result.message,
            reason: result.reason,
          });
        } else {
          batch.completed.push({ name: file.name, lectureName: result.lectureName });
          lastSuccess = { ...result, course };
        }
        continue;
      }

      if (result?.error === 'BUSY') {
        setProcessing(null);
        return;
      }

      batch.failed.push({ name: file.name, path: file.path, error: result });
      setProcessing({
        file,
        course,
        status: null,
        error: result,
        batch: { ...batch },
      });

      const action = await waitForBatchDecision();
      if (action === 'stop') {
        batchAbortRef.current = true;
        break;
      }
      if (action === 'skip') {
        continue;
      }
      if (action === 'retry_ok' && batchRetryOkRef.current) {
        batch.completed.push({
          name: file.name,
          lectureName: batchRetryOkRef.current.lectureName,
        });
        lastSuccess = { ...batchRetryOkRef.current, course };
        batchRetryOkRef.current = null;
      }
    }

    batch.finished = true;
    batchAbortRef.current = false;
    pendingFilesRef.current = [];
    setDroppedFiles([]);
    setPreferredCourse(null);

    setSelectedCourse(course);
    setProcessedLecture({
      course,
      batchImport: true,
      imported: batch.completed,
      skipped: batch.skipped,
      failed: batch.failed,
      lastLecture: lastSuccess,
    });

    setProcessing({
      file: uniqueFiles[uniqueFiles.length - 1] || null,
      course,
      status: { step: 'done' },
      error: null,
      batch: { ...batch, finished: true },
    });
  }, [runProcessing, dedupePdfFiles]);

  const beginIntake = useCallback((pdfFiles, options = {}) => {
    pendingFilesRef.current = pdfFiles;
    setDroppedFiles(pdfFiles);
    setPreferredCourse(options.preferredCourse || null);
    setPlacementSuggestion(null);
    setSuggestionLoading(!!pdfFiles[0]?.path);
    setIntakeKey((k) => k + 1);
    setShowCourseSelect(true);

    const first = pdfFiles[0];
    if (!first?.path) {
      setSuggestionLoading(false);
      return;
    }

    window.api.analyzePDF({ pdfPath: first.path })
      .then((analysis) => {
        if (!analysis?.success) {
          setPlacementSuggestion({ fileName: first.name, quickOnly: true });
          return;
        }
        const suggestedCourse =
          options.preferredCourse ||
          state.courses.find((c) => c.id === analysis.suggestedCourseId) ||
          null;
        setPlacementSuggestion({
          ...analysis,
          suggestedCourse,
          fileName: first.name,
        });
      })
      .catch(() => setPlacementSuggestion({ fileName: first.name, quickOnly: true }))
      .finally(() => setSuggestionLoading(false));
  }, [state.courses]);

  const handleFileDrop = useCallback((files, options = {}) => {
    if (!state.onboardingComplete) return;
    if (confirmInFlightRef.current || processingActiveRef.current) return;

    const pdfFiles = dedupePdfFiles((files || []).filter(
      (f) => f.name?.toLowerCase().endsWith('.pdf') || f.path?.toLowerCase().endsWith('.pdf')
    ));
    if (!pdfFiles.length) return;

    beginIntake(pdfFiles, options);
  }, [state.onboardingComplete, dedupePdfFiles, beginIntake]);

  const { isDragging } = useDropZone(handleFileDrop);

  const handleOpenPdf = useCallback(async () => {
    const picked = await window.api.openPdfs();
    if (!picked?.length) return;
    handleFileDrop(picked);
  }, [handleFileDrop]);

  const handleCourseConfirm = useCallback(async (course) => {
    if (!course?.id || confirmInFlightRef.current) return;

    const files = dedupePdfFiles(
      (pendingFilesRef.current.length ? pendingFilesRef.current : droppedFiles).filter((f) => f.path)
    );
    if (!files.length) return;

    confirmInFlightRef.current = true;
    setConfirmingIntake(true);
    setShowCourseSelect(false);
    setPlacementSuggestion(null);
    batchAbortRef.current = false;

    setProcessing({
      file: files[0],
      course,
      status: { step: 'starting', message: 'Preparing…' },
      error: null,
      batch: files.length > 1 ? { total: files.length, current: 1, completed: [], skipped: [], failed: [] } : null,
    });

    try {
      if (files.length === 1) {
        const result = await runProcessing(files[0], course);
        pendingFilesRef.current = [];
        setDroppedFiles([]);
        setPreferredCourse(null);

        if (result?.success) {
          if (result.skipped) {
            setSelectedCourse(course);
            setProcessing({
              file: files[0],
              course,
              status: { step: 'done', message: result.message },
              error: null,
              batch: {
                finished: true,
                total: 1,
                completed: [],
                skipped: [{
                  name: files[0].name,
                  lectureName: result.lectureName,
                  message: result.message,
                }],
                failed: [],
              },
            });
          } else {
            setProcessedLecture({ ...result, course });
            setSelectedCourse(course);
            setProcessing(null);
          }
        } else if (result?.error !== 'BUSY') {
          setProcessing({ file: files[0], course, error: result, batch: null });
        } else {
          setProcessing(null);
        }
        return;
      }

      await runBatchProcessing(files, course);
    } finally {
      confirmInFlightRef.current = false;
      setConfirmingIntake(false);
    }
  }, [droppedFiles, dedupePdfFiles, runProcessing, runBatchProcessing]);

  const handleRetry = useCallback(async () => {
    if (!processing?.file || !processing?.course) return;
    const { file, course, batch } = processing;
    confirmInFlightRef.current = true;
    const result = await runProcessing(file, course, batch);
    if (result?.success) {
      if (batch?.total > 1) {
        batchRetryOkRef.current = result;
        setProcessing((prev) => (prev ? { ...prev, error: null } : null));
        resolveBatchGate('retry_ok');
      } else {
        setProcessedLecture({ ...result, course });
        setSelectedCourse(course);
        setProcessing(null);
      }
    } else {
      setProcessing((prev) => (prev ? { ...prev, error: result } : null));
    }
    confirmInFlightRef.current = false;
  }, [processing, runProcessing]);

  const handleDismiss = useCallback(() => {
    if (processing?.batch?.finished) {
      setProcessing(null);
      return;
    }
    if (processing?.error && processing?.batch?.total > 1) {
      resolveBatchGate('stop');
      return;
    }
    batchAbortRef.current = true;
    resolveBatchGate('stop');
    setProcessing(null);
  }, [processing]);

  const handleSkipBatch = useCallback(() => {
    setProcessing((prev) => (prev ? { ...prev, error: null } : null));
    resolveBatchGate('skip');
  }, []);

  const handleStopBatch = useCallback(() => {
    batchAbortRef.current = true;
    resolveBatchGate('stop');
    setProcessing(null);
  }, []);

  const handleOpenLecture = useCallback((request) => {
    if (!request?.courseId) return;
    const course = (state.courses || []).find((c) => c.id === request.courseId);
    if (!course) return;
    setSelectedCourse(course);
    setLectureOpenRequest({ ...request, nonce: Date.now() });
  }, [state.courses]);

  const handleClearLectureOpenRequest = useCallback(() => {
    setLectureOpenRequest(null);
  }, []);

  const handleCancel = useCallback(() => {
    setShowCourseSelect(false);
    pendingFilesRef.current = [];
    setDroppedFiles([]);
    setPlacementSuggestion(null);
    setPreferredCourse(null);
    setSuggestionLoading(false);
  }, []);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-bg-primary">
        <div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!state.onboardingComplete) {
    return <Onboarding state={state} update={update} refresh={refresh} />;
  }

  return (
    <div className="relative h-screen overflow-hidden">
      {isDragging && (
        <div className="absolute inset-0 z-40 pointer-events-none">
          <div className="absolute inset-1 border-2 border-accent rounded-xl bg-accent/5 flex items-center justify-center">
            <div className="text-center">
              <div className="text-5xl mb-2">📄</div>
              <p className="text-accent text-lg font-semibold">Drop PDFs to add</p>
              <p className="text-accent/70 text-sm mt-1">Multiple files supported</p>
            </div>
          </div>
        </div>
      )}

      <MainLayout
        state={state}
        update={update}
        refresh={refresh}
        selectedCourse={selectedCourse}
        onSelectCourse={setSelectedCourse}
        processedLecture={processedLecture}
        onClearProcessed={() => setProcessedLecture(null)}
        onDropFiles={handleFileDrop}
        onOpenPdf={handleOpenPdf}
        onOpenLecture={handleOpenLecture}
        lectureOpenRequest={lectureOpenRequest}
        onClearLectureOpenRequest={handleClearLectureOpenRequest}
      />

      {showCourseSelect && (
        <CourseSelectModal
          key={intakeKey}
          courses={state.courses}
          files={droppedFiles}
          fileName={droppedFiles[0]?.name}
          suggestion={placementSuggestion}
          suggestionLoading={suggestionLoading}
          preferredCourse={preferredCourse}
          confirming={confirmingIntake}
          onConfirm={handleCourseConfirm}
          onCancel={handleCancel}
        />
      )}

      {processing && (
        <ProcessingModal
          processing={processing}
          onDismiss={handleDismiss}
          onRetry={handleRetry}
          onSkipBatch={processing.batch?.total > 1 ? handleSkipBatch : undefined}
          onStopBatch={processing.batch?.total > 1 ? handleStopBatch : undefined}
        />
      )}
    </div>
  );
}
