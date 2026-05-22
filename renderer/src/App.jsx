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
  const [showCourseSelect, setShowCourseSelect] = useState(false);
  const [placementSuggestion, setPlacementSuggestion] = useState(null);
  const [preferredCourse, setPreferredCourse] = useState(null);
  const [processing, setProcessing] = useState(null);
  const [processedLecture, setProcessedLecture] = useState(null);
  const [lectureRefreshEpoch, setLectureRefreshEpoch] = useState(0);
  const intakeBusyRef = useRef(false);
  const batchAbortRef = useRef(false);
  const batchGateRef = useRef(null);
  const batchRetryOkRef = useRef(null);

  const runProcessing = useCallback(async (file, course, batchMeta = null) => {
    if (!file?.path) return { success: false };

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
        courseName: course.name,
      });
    } catch (err) {
      return { success: false, error: 'UNKNOWN_ERROR', message: err.message };
    } finally {
      removeListener();
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

  const runBatchProcessing = useCallback(async (files, course) => {
    const batch = {
      total: files.length,
      current: 1,
      files,
      completed: [],
      failed: [],
      finished: false,
    };
    let lastSuccess = null;

    for (let i = 0; i < files.length; i++) {
      if (batchAbortRef.current) break;

      const file = files[i];
      batch.current = i + 1;

      const result = await runProcessing(file, course, { ...batch });

      if (result?.success) {
        batch.completed.push({ name: file.name, lectureName: result.lectureName });
        lastSuccess = { ...result, course };
        continue;
      }

      if (result?.error === 'BUSY') {
        intakeBusyRef.current = false;
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
    intakeBusyRef.current = false;
    setDroppedFiles([]);
    setPreferredCourse(null);

    setSelectedCourse(course);
    setProcessedLecture({
      course,
      batchImport: true,
      imported: batch.completed,
      failed: batch.failed,
      lastLecture: lastSuccess,
    });

    setProcessing({
      file: files[files.length - 1],
      course,
      status: { step: 'done' },
      error: null,
      batch: { ...batch, finished: true },
    });
  }, [runProcessing]);

  const handleFileDrop = useCallback((files, options = {}) => {
    if (!state.onboardingComplete) return;
    if (intakeBusyRef.current) return;
    intakeBusyRef.current = true;
    batchAbortRef.current = false;

    const pdfFiles = (files || []).filter(
      (f) => f.name?.toLowerCase().endsWith('.pdf') || f.path?.toLowerCase().endsWith('.pdf')
    );
    if (!pdfFiles.length) {
      intakeBusyRef.current = false;
      return;
    }

    setDroppedFiles(pdfFiles);
    setPreferredCourse(options.preferredCourse || null);

    const first = pdfFiles[0];
    if (!first?.path) {
      intakeBusyRef.current = false;
      setShowCourseSelect(true);
      return;
    }

    window.api.analyzePDF({ pdfPath: first.path })
      .then((analysis) => {
        const suggestedCourse =
          options.preferredCourse ||
          state.courses.find((c) => c.id === analysis?.suggestedCourseId) ||
          null;
        setPlacementSuggestion({
          ...analysis,
          suggestedCourse,
          fileName: first.name,
        });
      })
      .catch(() => setPlacementSuggestion(null))
      .finally(() => setShowCourseSelect(true));
  }, [state.onboardingComplete, state.courses]);

  const { isDragging } = useDropZone(handleFileDrop);

  const handleOpenPdf = useCallback(async () => {
    const picked = await window.api.openPdfs();
    if (!picked?.length) return;
    handleFileDrop(picked);
  }, [handleFileDrop]);

  const handleCourseConfirm = useCallback(async (course) => {
    setShowCourseSelect(false);
    setPlacementSuggestion(null);
    const files = droppedFiles.filter((f) => f.path);
    if (!files.length) {
      intakeBusyRef.current = false;
      return;
    }

    intakeBusyRef.current = true;
    batchAbortRef.current = false;

    if (files.length === 1) {
      const result = await runProcessing(files[0], course);
      intakeBusyRef.current = false;
      setDroppedFiles([]);
      setPreferredCourse(null);
      if (result?.success) {
        setProcessedLecture({ ...result, course });
        setSelectedCourse(course);
        setProcessing(null);
      } else if (result?.error !== 'BUSY') {
        setProcessing({ file: files[0], course, error: result, batch: null });
      } else {
        setProcessing(null);
      }
      return;
    }

    await runBatchProcessing(files, course);
  }, [droppedFiles, runProcessing, runBatchProcessing]);

  const handleRetry = useCallback(async () => {
    if (!processing) return;
    const { file, course, batch } = processing;
    intakeBusyRef.current = true;
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
        intakeBusyRef.current = false;
      }
    } else {
      setProcessing((prev) => (prev ? { ...prev, error: result } : null));
      if (!batch?.total) intakeBusyRef.current = false;
    }
  }, [processing, runProcessing]);

  const handleDismiss = useCallback(() => {
    if (processing?.batch?.finished) {
      setProcessing(null);
      intakeBusyRef.current = false;
      return;
    }
    if (processing?.error && processing?.batch?.total > 1) {
      resolveBatchGate('stop');
      return;
    }
    batchAbortRef.current = true;
    resolveBatchGate('stop');
    intakeBusyRef.current = false;
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
    intakeBusyRef.current = false;
  }, []);

  const handleCancel = useCallback(() => {
    intakeBusyRef.current = false;
    setShowCourseSelect(false);
    setDroppedFiles([]);
    setPlacementSuggestion(null);
    setPreferredCourse(null);
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
      />

      {showCourseSelect && (
        <CourseSelectModal
          courses={state.courses}
          files={droppedFiles}
          fileName={droppedFiles[0]?.name}
          suggestion={placementSuggestion}
          preferredCourse={preferredCourse}
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
