import React, { useState } from 'react';
import Sidebar from '../components/Sidebar';
import CoursePage from './CoursePage';
import SettingsPanel from './SettingsPanel';
import DropHint from '../components/DropHint';
import StudyControlPage from './StudyControlPage';
import DashboardPage from './DashboardPage';
import PlannerPage from './PlannerPage';

export default function MainLayout({
  state, update, refresh,
  selectedCourse, onSelectCourse,
  processedLecture, onClearProcessed, lectureRefreshEpoch = 0,
  onDropFiles,
  onOpenPdf
}) {
  const [showSettings, setShowSettings] = useState(false);
  const [showControl, setShowControl] = useState(false);
  const [showHome, setShowHome] = useState(true);
  const [showPlanner, setShowPlanner] = useState(false);

  function closeAll() {
    setShowSettings(false);
    setShowControl(false);
    setShowHome(false);
    setShowPlanner(false);
  }

  const handleLocalDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer.files).filter(
      f => f.name.toLowerCase().endsWith('.pdf')
    );
    if (files.length > 0) {
      onDropFiles(files.map(f => ({ name: f.name, path: f.path })));
    }
  };

  return (
    <div className="flex h-screen bg-bg-primary">
      {/* Sidebar */}
      <Sidebar
        courses={state.courses}
        selectedCourse={selectedCourse}
        onSelectCourse={(c) => { closeAll(); onSelectCourse(c); }}
        onOpenHome={() => { closeAll(); setShowHome(true); onSelectCourse(null); }}
        showHome={showHome}
        onOpenPlanner={() => { closeAll(); setShowPlanner(true); onSelectCourse(null); }}
        showPlanner={showPlanner}
        onOpenSettings={() => { closeAll(); setShowSettings(true); onSelectCourse(null); }}
        onOpenControl={() => { closeAll(); setShowControl(true); onSelectCourse(null); }}
        showSettings={showSettings}
        showControl={showControl}
        onOpenPdf={onOpenPdf}
      />

      {/* Main content */}
      <div
        className="flex-1 overflow-hidden"
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={handleLocalDrop}
      >
        {showSettings ? (
          <SettingsPanel
            state={state}
            update={update}
            refresh={refresh}
            onClose={() => { closeAll(); setShowHome(true); }}
          />
        ) : showControl ? (
          <StudyControlPage
            state={state}
            update={update}
          />
        ) : showPlanner ? (
          <PlannerPage />
        ) : showHome ? (
          <DashboardPage onOpenPdf={onOpenPdf} onOpenPlanner={() => { closeAll(); setShowPlanner(true); }} />
        ) : selectedCourse ? (
          <CoursePage
            course={selectedCourse}
            processedLecture={processedLecture}
            onClearProcessed={onClearProcessed}
            onDropFiles={(files, options) => onDropFiles(files, options)}
            state={state}
            update={update}
          />
        ) : (
          <DropHint onOpenPdf={onOpenPdf} />
        )}
      </div>
    </div>
  );
}
