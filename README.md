# Sima — Embodied Carbon Tracking

Sima measures and tracks the embodied carbon (kgCO₂e) of construction projects, from a first
conceptual estimate through the real Bill of Quantities, the Work Order, and every running bill.
It is a FastAPI backend plus a React (Vite) frontend that talk over HTTP.

```
.
├── backend/    FastAPI app, calculation engines, emission-factor data, tests
└── frontend/   React 19 + Vite single-page app
```

## What it does

| Area | What you can do |
|---|---|
| **Conceptual Estimate** | Early-stage estimate from project form inputs, before any BOQ exists. |
| **Analyze a BOQ / Work Order** | Upload one or more Excel BOQs and/or a Work Order PDF. Each upload runs as a background job, so you can keep working while it calculates. |
| **Projects** | Lock a result in as a project baseline, then add running bills (COP PDFs) and watch cumulative carbon against the baseline. |
| **Carbon Tracking** | Cumulative-vs-baseline trajectory, projected final, carbon intensity (kg/m²), material breakdown per bill. |
| **Material Swap Sandbox** | Describe a swap in plain language ("reduce RCC to 65%, keep 35% as M25 with GGBS"). The numbers are recomputed by the engine, never guessed; confirm it to fork a *beta* project. |
| **Reports, Material Mapping, Emission Factors, Operational Emissions** | Reporting, item-code mapping queue, versioned factor settings, and a Scope 1 & 2 calculator. |

## Quick start

### 1. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate  (Git Bash: source venv/Scripts/activate)
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Health check: <http://localhost:8000/health>. Interactive API docs: <http://localhost:8000/docs>.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Opens at <http://localhost:3000> and talks to `http://localhost:8000` by default. To point it elsewhere,
set `VITE_API_BASE` in `frontend/.env`. The backend's CORS list already allows ports 3000 and 5173.

### 3. Optional: `backend/.env` (LLM and database)

Copy `backend/.env.example` to `backend/.env` (never commit it). Everything works without it: data is kept in
local JSON files, and the features that use an LLM (chat assistant, free-text swap parsing, swap advice) fall
back to keyword rules or plain text.

```env
GROQ_API_KEY=your-key                 # https://console.groq.com/keys  (LLM_PROVIDER defaults to groq)
GROQ_MODEL=openai/gpt-oss-120b
DATABASE_URL=postgresql://...         # Supabase; leave empty to keep using local JSON files
```

An LLM is only ever used to read intent and write explanatory text. **Every carbon number comes from the
deterministic engines.**

### 4. Optional: store data in Supabase (Postgres) instead of local files

See [Using Supabase for storage](#using-supabase-for-storage) below.

## How a BOQ becomes a number

1. **Parse.** The header row is found in the first 15 rows of each sheet; after that *every* row is read.
   Column purposes come from header text, and each line keeps its section / category / subsection context
   (so a bare "Footings" row under "RCC CONCRETE" is understood).
2. **Classify.** Ordered keyword rules assign a material category (rcc, pcc, reinforcement steel,
   structural steel, brick/block, plaster, tile, paint, timber, aluminium/uPVC, glass, masonry).
   Formwork and excavation are excluded. Concrete grade and cement type are read from the text; if absent,
   the defaults are M30 PPC (RCC) and M10 PPC (PCC).
3. **Compute.** Quantity × emission factor, only when the unit suits the category (m³ for concrete, mass
   for steel, area for finishes). India-specific IFC factors, CEA grid-adjusted, are the primary source.
4. **Report coverage honestly.** Coverage is value-weighted (computed value ÷ total value), and every
   line that wasn't computed is listed with the reason.

**Work Orders and bills** use the company's master item-code catalog (stored per company as `master_item_codes.json`; see Storage below).
Concrete lines are reported as **RCC** or **PCC** (label only; the calculation is unchanged). Bills are
**cumulative**: the latest bill is the current billed-to-date state, and a bill's material breakdown is
read from that latest bill.

### Multiple sheets and multiple BOQs

- A workbook calculates **every real BOQ sheet**, not just the first. Rate lists and summary sheets are
  detected and left out automatically, with the reason shown.
- You can add several BOQ files one after another; all ticked sheets are calculated together as one BOQ.
  Each file lists its sheets with checkboxes, and the result shows a per-sheet breakdown.
- If two sheets look like the same scope (for example a "Combined" sheet equal to Structure + Architecture),
  a **double-counting warning** is shown. It never blocks the upload.

### Swap Sandbox and beta projects

A swap is matched to the project's real lines and re-computed. Confirming it forks a **beta** project; for
projects with bills, the swap is applied to the latest bill's own billed-to-date figures, scaled per
category from the project-level change (a stored bill keeps category totals, not individual lines, so this
is an estimate and is labelled as such).

## Backend layout

```
backend/app/
├── main.py                  routers + CORS
├── api/                     HTTP layer (uploads, boq_carbon, wo_carbon, phase3, phase4, swap_sandbox, projects, ...)
├── services/
│   ├── boq_carbon/          parser, sheets, classifier, engine, substitution engine, swap sandbox
│   ├── wo_carbon/           Work Order parser + engine
│   ├── phase3*.py           baselines, bills (COP), running-carbon dashboard
│   ├── phase4.py            confirm / recalculate / beta-fork of a swap
│   ├── concrete_subtype.py  rcc vs pcc label for Work Order / bill concrete
│   ├── upload_jobs.py       background BOQ / WO jobs; job_store.py keeps their status
│   └── ice_factors.py, emission_factors.py, cea_adjustment.py   factor sources
├── data/
│   ├── ice_db/              emission factors, factor history, substitution catalog
│   └── companies/<id>/      local-file mode only: master item codes, projects, bills, jobs (JSON)
└── core/config.py           settings from .env
backend/db/schema.sql        the one table the database mode needs
backend/scripts/             migrate_files_to_database.py, migrate_concrete_to_rcc_pcc.py, ...
```

Storage is **either** plain JSON files under `backend/app/data/` (default, no setup) **or** a Postgres/Supabase
`documents` table, chosen by whether `DATABASE_URL` is set. All reads and writes go through
`services/doc_store.py`, so nothing else in the code knows which one is in use. Jobs run in-process, so
restarting the server mid-calculation leaves that job stuck as "running"; delete it from Recent Uploads and re-run.

## Using Supabase for storage

Everything you edit in the app (projects, baselines, bills, upload jobs and results, recommendations, audit
logs, registries, each company's master item codes) is stored as JSON documents in one table. Static reference
data (`data/ice_db/*`: emission factors, factor history, substitution catalog) stays in the repo.

1. **Create a project** at <https://supabase.com> (free plan is fine; pick the region closest to your backend host).
   Save the database password you choose.
2. **Create the table.** Supabase dashboard → *SQL Editor* → *New query* → paste the contents of
   `backend/db/schema.sql` → *Run*. (It also turns on row-level security with no policies, so the public API
   keys can't read the table; only your backend, using the database password, can.)
3. **Get the connection string.** Dashboard → *Connect* (top bar) → **Session pooler** → copy the URI
   (`postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres`) and replace
   `[YOUR-PASSWORD]` with your database password. Use the pooler string, not "Direct connection": the direct
   host is IPv6-only and fails from many hosts, including Render's free tier.
4. **Point the backend at it.** Put it in `backend/.env` as `DATABASE_URL=...` (and as an environment variable
   on your host when you deploy). Install the driver once: `pip install -r requirements.txt`.
5. **Copy your existing local data over** (once, from `backend/`):

   ```bash
   python scripts/migrate_files_to_database.py             # dry run: lists what would be copied
   python scripts/migrate_files_to_database.py --apply     # copies and verifies every document
   ```

   Local files are left untouched, so you can switch back by emptying `DATABASE_URL`.
6. **Start the backend.** If `DATABASE_URL` is set it is used; otherwise the app uses local files.

Notes: the free plan has a 500 MB database and pauses a project after a week of inactivity. A job result is
roughly 0.1–4 MB, so storage is not a concern for normal use. `pytest` always uses local files; to run the suite
against a *throwaway* Postgres, set `SIMA_TEST_DATABASE_URL` (this empties its `documents` table, so never
point it at real data).

## Running with Docker

Both services have a Dockerfile, and `docker-compose.yml` runs them together:

```bash
cp backend/.env.example backend/.env      # then fill in GROQ_API_KEY and DATABASE_URL
docker compose up --build
```

- Frontend: <http://localhost:3000> (nginx serving the built React app)
- Backend API: <http://localhost:8000> (docs at `/docs`)

**Data is stored in a database, not in the containers** (containers are disposable). Choose one:

- **Supabase:** set its Session-pooler URI as `DATABASE_URL` in `backend/.env` (see
  [Using Supabase for storage](#using-supabase-for-storage)), then run `docker compose up --build`.
- **Local Postgres in Docker:** set `DATABASE_URL=postgresql://sima:sima@db:5432/sima` in `backend/.env`, then
  run `docker compose --profile localdb up --build`. The table is created automatically on first start. To load
  existing local data into it, run `python scripts/migrate_files_to_database.py --apply --database-url
  postgresql://sima:sima@localhost:5432/sima` from `backend/` (the compose file does not publish the DB port by
  default; add `ports: ["5432:5432"]` to the `db` service for this one-off step).

Settings you can override in the shell or a root-level `.env`:

| Variable | Default | Meaning |
|---|---|---|
| `VITE_API_BASE` | `http://localhost:8000` | Where the **browser** finds the API. Baked into the frontend at build time, so re-run `docker compose build frontend` after changing it. |
| `CORS_ORIGINS` | `http://localhost:3000` | Browser origin(s) the API accepts, comma-separated. |

To deploy the images on a real host, build with your public API URL, for example
`docker build --build-arg VITE_API_BASE=https://api.example.com ./frontend`, and run the backend image with
`DATABASE_URL`, `GROQ_API_KEY` and `CORS_ORIGINS=https://your-frontend-domain` set. The backend listens on
`$PORT` (default 8000).

## Frontend layout

`frontend/src/` — `components/` (one folder per area: `phase2` uploads and result dashboards, `project`,
`tracking`, `portfolio`, `common/charts`, ...), `context/ProjectContext.jsx` (active company, project,
background-job polling, toasts), `api/client.js` (every backend call). Routing is `react-router-dom`;
Portfolio is the home page.

## Tests and scripts

```bash
cd backend
pytest
```

`backend/scripts/` holds one-off tools, for example `migrate_concrete_to_rcc_pcc.py` (relabels stored
Work Order / bill results from "concrete" to rcc/pcc; dry-run by default, `--apply` to write, backs up first).

## Troubleshooting

- **Blank page or `ERR_CONNECTION_REFUSED`:** both servers must be running (backend on 8000, frontend on 3000);
  check the browser console for the first error.
- **Frontend can't reach the API:** check `VITE_API_BASE` and that the backend is on the same port.
- **Chat / swap parsing seems "dumb":** no LLM is reachable; the keyword fallback is in use. Check that
  `GROQ_API_KEY` is set in `backend/.env`.
- **Database connection errors:** use the Session pooler string (not Direct), check the password has no
  unescaped special characters (URL-encode `@`, `/`, `:` etc.), and that `backend/db/schema.sql` was run.
- **Swap Sandbox shows 0 before and after:** the project must have lines in the swapped category
  (RCC/PCC exist for BOQ, Work Order and bill projects). Re-upload older projects if they predate that.

## Notes

- Keep `backend/.env` (it holds your Groq key and database password) and the Python `venv/` out of git (see `.gitignore`).
- Emission factors are versioned (`data/ice_db/factor_history.json`); change them through the
  Emission Factors screen or `backend/scripts/update_emission_factor.py`, not by editing numbers in code.
