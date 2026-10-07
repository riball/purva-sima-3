"""FastAPI entrypoint for the conceptual carbon calculator backend."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import boq_carbon, boq_carbon_substitute, calculate, companies, factors, form, onboarding, operational_emissions, phase3, phase4, projects, refine, substitute, uploads, wo_carbon

app = FastAPI(title="Conceptual Carbon Calculator API")

# Required for the frontend (Vite dev server) to be able to call this API
# at all -- without this middleware, browsers block every request with a
# CORS error before it even reaches these routes, regardless of whether
# the routes themselves are correct.
# Add your production frontend's origin here too once deployed.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173",
                   "http://192.168.1.6:5173",
                   "http://127.0.0.1:5173",
                   # carbo-front (the current frontend) defaults to port 3000
                   "http://localhost:3000",
                   "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(form.router)
app.include_router(calculate.router)
app.include_router(substitute.router)
app.include_router(refine.router)
app.include_router(boq_carbon.router)  # Phase 2: raw-BOQ-in, carbon-out -- standalone from the tiered form flow
app.include_router(boq_carbon_substitute.router)  # Phase 2: material substitution, real recompute against the catalog
app.include_router(wo_carbon.router)  # Phase 2 (WS02): raw-Work-Order-in, carbon-out -- wo_carbon_engine's first HTTP endpoint
app.include_router(onboarding.router)  # WS05: per-company item-code & Work-Order onboarding pipeline
app.include_router(factors.router)  # WS09: read-only versioned emission-factor history
app.include_router(phase3.router)  # WS10: Phase 3 -- project baseline, periodic bills, running-carbon dashboard
app.include_router(companies.router)  # WS15: a real company registry -- list/create, replacing the old free-text-only company_id
app.include_router(phase4.router)  # WS14: Phase 4 -- confirm/recalculate/audit, the last workstream on the roadmap
app.include_router(projects.router)  # UX refinement: named-project registry -- save/search/rename a project by name from anywhere
app.include_router(uploads.router)  # UX refinement: background BOQ/WO calculation jobs + combined upload -- see app/services/job_store.py, upload_jobs.py
app.include_router(operational_emissions.router)  # New feature: Scope 1 & 2 operational emissions calculator (site fuel + grid electricity) -- see app/services/operational_emissions.py for why this is its own router/data model, separate from the embodied-carbon project pipeline above


@app.get("/health")
def health():
    return {"status": "ok"}