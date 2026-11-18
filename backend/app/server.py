"""Single-service entrypoint: the API under /api and the built React app at /.

Used by the root Dockerfile so ONE deployment serves everything:

    uvicorn app.server:root --host 0.0.0.0 --port $PORT

  /api/...   the FastAPI app from app.main (docs at /api/docs, health at /api/health)
  /...       the built frontend (single-page app: unknown paths serve index.html)

The frontend bundle is looked up in $FRONTEND_DIST (default: <backend>/static). If it is not
there (e.g. local development without a build) only the API is served. For local development
you can still run `uvicorn app.main:app` and `npm run dev` separately as before.
"""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.main import app as api_app


class SPAStaticFiles(StaticFiles):
    """Static files, but a path that matches no file serves index.html so client-side
    routes (/projects/123, /uploads/abc) survive a browser refresh. Missing build
    assets still return a real 404."""

    async def get_response(self, path, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404 and not path.startswith("assets/"):
                return await super().get_response("index.html", scope)
            raise


root = FastAPI(title="Sima", docs_url=None, redoc_url=None, openapi_url=None)
root.mount("/api", api_app)

_dist = Path(os.getenv("FRONTEND_DIST") or Path(__file__).resolve().parent.parent / "static")
if (_dist / "index.html").is_file():
    root.mount("/", SPAStaticFiles(directory=str(_dist), html=True), name="web")
else:

    @root.get("/")
    def _no_frontend() -> dict:
        return {"detail": "Frontend build not found; the API is at /api (docs: /api/docs)."}
