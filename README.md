# Carbo — Combined Project

This folder contains both halves of the Carbo app, merged into one place so you can run them side by side:

```
carbo/
├── backend/    FastAPI backend (Python)
└── frontend/   React + Vite frontend (the carbo-front build, cleaned up)
```

The two are separate services that talk over HTTP — no code was rearchitected to "merge" them; the
frontend's API client already covers every backend route, and CORS is configured for it.

## 1. Run the backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows (Git Bash): source venv/Scripts/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Optional `.env` in `backend/` for the LLM-backed endpoints (chat, etc.) — see `backend/app/core/config.py`
for `LLM_PROVIDER`, `OLLAMA_BASE_URL`/`OLLAMA_MODEL`, or `GROQ_API_KEY`/`GROQ_MODEL`. Everything else works
without it.

API lives at `http://localhost:8000` (health check: `http://localhost:8000/health`).

## 2. Run the frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Dev server runs at `http://localhost:3000` (this frontend's default Vite port) and talks to the backend
at `http://localhost:8000` by default — see `frontend/src/api/client.js` / `VITE_API_BASE`. Copy
`frontend/.env.example` to `frontend/.env` if you need to point it elsewhere.

`backend/app/main.py`'s CORS list already includes `http://localhost:3000` (this frontend's port) alongside
`:5173` (the older frontend's port), so both can talk to the same backend without edits.

## What changed to make this frontend production-ready

This frontend (`carbo-front`) was built in Google AI Studio, which scaffolds every project with a mock
Express server and sample data standing in for a real backend. Since you now have the real backend, the
following was removed/fixed rather than carried over:

- **`server.js`** — the AI Studio mock API server (hardcoded fake companies/projects, `501` stub for
  everything else). Deleted; the frontend now calls `backend/` directly, like the rest of its API client
  already assumed.
- **`metadata.json`** — AI Studio's own project manifest (declared a Gemini API capability the app never
  used). Deleted.
- **`express`, `tsx`, `esbuild`** dependencies and the `dev`/`build`/`start` scripts built around
  `server.js` — removed from `package.json` in favor of plain `vite`/`vite build`/`vite preview`, matching
  how a normal Vite + React app is run.
- **Duplicated video asset** — the background video for the landing page existed in three places
  (`src/assets/video/`, `public/assets/video/`, and a stray `public/src/assets/video/` — a nested copy bug
  from the AI Studio export) totaling ~63MB. Kept the one real copy (bundled via `import` in
  `LandingPage.jsx`) and removed the two duplicates and the redundant `<source>` tags pointing at them.
- **Unused images** — `hero.png`, `react.svg`, `vite.svg`, and an unused `blueprint_background_*.jpg` were
  never referenced anywhere in the app; removed.
- **`bun.lock`** — stale lockfile from the old dependency set; removed since `npm install` regenerates it
  (or `bun install`, if you prefer bun — nothing here depends on it).
- **`API_BASE` default** in `src/api/client.js` — was `''` (same-origin, relying on the mock server sitting
  behind the same host/port as the page). Changed to default to `http://localhost:8000` so it points at the
  real backend out of the box.

## Feature coverage check

I compared this frontend's API usage against every route the backend exposes (`form`, `calculate`,
`substitute`, `refine`, `boq-carbon` + substitution catalog, `wo-carbon`, `phase3` incl. baseline/bills/chat,
`phase4` recommendations/audit-log, `factors`, `companies`) and against the previous frontend build. This
frontend already calls every one of those — nothing was missing, so no new screens/API calls were needed.

The one backend router this frontend doesn't surface is `onboarding` (`app/api/onboarding.py` — a
per-company item-code/Work-Order onboarding pipeline). The previous frontend didn't wire it up either; it
reads as an internal/admin data-loading pipeline (run via `backend/scripts/`) rather than an end-user
screen, so it was left out here too. Flag it if you did want it in the UI and I'll add a screen for it.
