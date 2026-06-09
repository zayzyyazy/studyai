const { contextBridge, ipcRenderer } = require('electron');

// Transform studyvault_claude plan format → frozen-frontend plan format
function transformPlan(plan) {
  if (!plan) return null;
  const DAY_MAP = { Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3, Friday: 4, Saturday: 5, Sunday: 6 };
  // Compute Monday of current week for weekStartDate
  const now = new Date();
  const dow = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
  monday.setHours(0, 0, 0, 0);
  const blocks = [];
  for (const day of (plan.days || [])) {
    const dayOfWeek = DAY_MAP[day.day] ?? 0;
    for (const block of (day.blocks || [])) {
      blocks.push({
        id: block.id,
        dayOfWeek,
        courseId: block.courseId || '',
        courseName: block.courseName || '',
        lectureId: block.lectureId || '',
        lectureName: block.lectureName || '',
        lecturePath: block.lecturePath || '',
        blockType: block.blockType || 'study',
        estimatedMinutes: block.minutes || 30,
        status: block.status === 'planned' ? 'pending' : (block.status || 'pending'),
        goal: block.goal || block.why || '',
        why: block.why || '',
      });
    }
  }
  return {
    weekStartDate: plan.createdAt ? monday.toISOString() : new Date().toISOString(),
    blocks,
    narrative: plan.narrative,
    capacityHours: plan.capacityHours,
    plannedHours: plan.plannedHours,
  };
}

contextBridge.exposeInMainWorld('api', {
  // Store
  storeGet: (key) => ipcRenderer.invoke('store:get', key),
  storeSet: (key, value) => ipcRenderer.invoke('store:set', key, value),
  storeGetAll: () => ipcRenderer.invoke('store:getAll'),

  // Dialog
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  openPdf: () => ipcRenderer.invoke('dialog:openPdf'),
  openPdfs: () => ipcRenderer.invoke('dialog:openPdfs'),

  // Shell
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),

  // Vault
  checkVaultPath: (p) => ipcRenderer.invoke('vault:checkPath', p),
  getLectures: (courseName) => ipcRenderer.invoke('vault:getLectures', courseName),
  getLectureDetails: (data) => ipcRenderer.invoke('vault:getLectureDetails', data),
  getCourseOverview: () => ipcRenderer.invoke('vault:getCourseOverview'),
  getDashboard: () => ipcRenderer.invoke('vault:getDashboard'),
  readFile: (filePath) => ipcRenderer.invoke('vault:readFile', filePath),
  saveLectureNotes: (data) => ipcRenderer.invoke('lecture:saveNotes', data),
  loadStudyCard: (data) => ipcRenderer.invoke('lecture:loadStudyCard', data),
  generateStudyCard: (data) => ipcRenderer.invoke('lecture:generateStudyCard', data),
  markLectureDone: (data) => ipcRenderer.invoke('lecture:markDone', data),

  // Planner — native API
  getPlannerState: () => ipcRenderer.invoke('planner:getState'),
  generateWeeklyPlan: (data) => ipcRenderer.invoke('planner:generateWeeklyPlan', data),
  updateStudyBlock: (data) => ipcRenderer.invoke('planner:updateBlock', data),
  plannerChat: async (data) => {
    // Support both frozen-frontend {messages, weeklyHours} and native {message}
    let message = data.message;
    if (!message && Array.isArray(data.messages)) {
      const last = [...data.messages].reverse().find(m => m.role === 'user');
      message = last?.content || '';
    }
    const result = await ipcRenderer.invoke('planner:chat', { message });
    if (!result.success) return result;
    const planUpdate = result.plan ? transformPlan(result.plan) : null;
    return { success: true, reply: result.reply, planUpdate };
  },

  // Planner — compatibility aliases for frozen-frontend pages
  getPlannerContext: async () => {
    const state = await ipcRenderer.invoke('planner:getState');
    const weeklyPlan = transformPlan(state.plan);
    return {
      weeklyPlan,
      weeklyHoursMax: state.settings?.weeklyCapacityHours || 14,
      courses: (state.world?.courses || []).map(c => ({ id: c.id, name: c.name })),
    };
  },
  generatePlan: async (data) => {
    const result = await ipcRenderer.invoke('planner:generateWeeklyPlan', {
      weeklyCapacityHours: data.weeklyHours,
      constraints: data.constraints ? { notes: data.constraints } : {},
    });
    if (!result.success) return { success: false, error: result.error || 'Plan generation failed' };
    return { success: true, plan: transformPlan(result.plan) };
  },
  updatePlanBlock: async ({ blockId, changes }) => {
    const status = typeof changes === 'object' ? changes.status : changes;
    const mapped = status === 'pending' ? 'planned' : status;
    const result = await ipcRenderer.invoke('planner:updateBlock', { blockId, status: mapped });
    if (!result.success) return { success: false };
    return { success: true, plan: transformPlan(result.plan) };
  },
  savePlan: () => Promise.resolve({ success: true }),
  clearPlan: () => ipcRenderer.invoke('planner:clearPlan'),

  // PDF Processing
  analyzePDF: (data) => ipcRenderer.invoke('pdf:analyze', data),
  processPDF: (data) => ipcRenderer.invoke('pdf:process', data),
  generateLectureOverview: (data) => ipcRenderer.invoke('lecture:generateOverview', data),
  trackLectureActivity: (data) => ipcRenderer.invoke('lecture:trackActivity', data),
  generateDeepDive: (data) => ipcRenderer.invoke('lecture:generateDeepDive', data),
  generateSubtopicDive: (data) => ipcRenderer.invoke('lecture:generateSubtopicDive', data),
  generateTopicQuiz: (data) => ipcRenderer.invoke('lecture:generateTopicQuiz', data),
  loadTopicQuiz: (data) => ipcRenderer.invoke('lecture:loadTopicQuiz', data),
  saveQuizAttempt: (data) => ipcRenderer.invoke('lecture:saveQuizAttempt', data),
  generateLectureQuizInteractive: (data) => ipcRenderer.invoke('lecture:generateLectureQuizInteractive', data),
  loadLectureQuizInteractive: (data) => ipcRenderer.invoke('lecture:loadLectureQuizInteractive', data),
  saveLectureQuizAttempt: (data) => ipcRenderer.invoke('lecture:saveLectureQuizAttempt', data),
  generateAufgaben: (data) => ipcRenderer.invoke('lecture:generateAufgaben', data),
  loadAufgaben: (data) => ipcRenderer.invoke('lecture:loadAufgaben', data),
  saveAufgabenProgress: (data) => ipcRenderer.invoke('lecture:saveAufgabenProgress', data),
  askLectureQuick: (data) => ipcRenderer.invoke('lecture:askQuick', data),
  listNoteCards: (data) => ipcRenderer.invoke('lecture:listNoteCards', data),
  saveNoteCard: (data) => ipcRenderer.invoke('lecture:saveNoteCard', data),
  deleteNoteCard: (data) => ipcRenderer.invoke('lecture:deleteNoteCard', data),
  suggestDeepSteps: (data) => ipcRenderer.invoke('lecture:suggestDeepSteps', data),
  deleteLecture: (data) => ipcRenderer.invoke('lecture:delete', data),

  // Status listener (one-way from main to renderer)
  onProcessingStatus: (callback) => {
    const listener = (_, status) => callback(status);
    ipcRenderer.on('pdf:status', listener);
    return () => ipcRenderer.removeListener('pdf:status', listener);
  }
});
