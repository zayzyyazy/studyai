# StudyAI

Local-first desktop lecture learning system — turns PDFs into structured, teachable study surfaces.

## What it does

- **Courses** — real study containers (semester, ECTS, priority, status)
- **PDF intake** — drag & drop, **batch import**, file picker (multi-select), stable processing, lecture structure v5
- **My note space + study card** — private notes per lecture; AI builds a personal study card from *your* notes (grounded on the lecture)
- **Overview** — focus theme, core themes, topic tree, prerequisites, course threads
- **Summary / Concepts** — distinct roles, language-aware (German lectures stay German)
- **Deep Dive** — per-topic modes: Verstehen, Beispiel, Prüfungsfalle, Kursbezug (links to prior lectures)
- **Study path** — ordered units per lecture (understand → example → practice) with course connections
- **Interactive Quiz** — in-app MCQ with feedback (lecture-wide + per deep dive)
- **Aufgaben** — lecture-grounded exercises with hints, worked solutions, and progress tracking
- **Notes** — auto-saved per lecture
- **Dashboard & Planner** — what to study today, weekly plan, continue items

## Requirements

- Node.js 18+
- macOS (primary target; Electron builds for Mac)
- OpenAI API key (generation only — vault and UI are fully local)

## Run locally

```bash
cd /Users/zay/Projects/Apps/StudyAI
npm install
npm run dev
```

Vite serves the renderer on port 5173; Electron opens automatically.

## Build desktop app

```bash
npm run build:renderer
npm run build
```

Packaged app output:

```
/Users/zay/Projects/Apps/StudyAI/dist-app/mac-arm64/StudyAI.app
```

(or `mac` on Intel)

## Vault layout

```
{vaultPath}/{CourseName}/{LectureName}/
  original.pdf
  extracted.txt
  summary.md
  concepts.md
  overview.md
  quiz.md
  aufgaben.json
  aufgaben.md
  aufgaben_progress.json
  notes.md
  meta.json
  lecture_structure.json
  interactive_quiz.json
  deep_dives/
```

Configure vault path and API key in **Settings** on first launch.

## Base

Merged from:

- `StudyAI_Claude_May17_NEWEST` — backend (structure v5, planner, thread-aware deep dives)
- `StudyAI_Freeze_dot_claude` — React UI shell

Unified as **`/Users/zay/Projects/Apps/StudyAI`** — the single canonical app.
