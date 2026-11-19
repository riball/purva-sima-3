# syntax=docker/dockerfile:1
#
# Image for Azure Container Apps (built by .github/workflows/azure.yml).
#
#   docker build --platform linux/amd64 -f deploy/Dockerfile -t sima .
#   docker run --rm -p 8080:8080 --env-file backend/.env sima
#   -> http://localhost:8080 (web app), http://localhost:8080/api/health
#
# The build context is the repository root. deploy/Dockerfile.dockerignore
# (picked up automatically with -f deploy/Dockerfile) keeps .git, .env files,
# local data, the committed venv, tests and logs out of it.
#
# This file sits next to the repo's own Dockerfile (used by docker compose and
# Render) and does not replace it. Same app, same layout (API under /api, the
# React app at /, one port). Differences: listens on 8080 by default, Python
# packages are installed in a separate stage (no pip/pytest/build leftovers in
# the final image), and uvicorn trusts Azure's proxy headers (https links).

# ---- 1. Build the React web app (plain files, so build natively) ----
FROM --platform=$BUILDPLATFORM node:22-slim AS web
WORKDIR /web
# On networks that block registry.npmjs.org, build with
#   --build-arg NPM_REGISTRY=https://registry.yarnpkg.com/
ARG NPM_REGISTRY=https://registry.npmjs.org/
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund --registry="$NPM_REGISTRY"
COPY frontend/ ./
# The API is on the same address under /api (see backend/app/server.py).
ENV VITE_API_BASE=/api
RUN npm run build

# ---- 2. Python packages in a virtualenv ----
FROM python:3.12-slim AS deps
ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
COPY backend/requirements.txt /tmp/requirements.txt
# pytest is only for the test suite; everything else is needed at runtime.
RUN grep -viE '^[[:space:]]*pytest([^a-z0-9_-]|$)' /tmp/requirements.txt > /tmp/runtime.txt \
    && pip install -r /tmp/runtime.txt \
    && find /opt/venv -name '__pycache__' -prune -exec rm -rf {} + \
    && find /opt/venv -name 'tests' -path '*site-packages/*/tests' -prune -exec rm -rf {} +

# ---- 3. Runtime ----
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/opt/venv/bin:$PATH \
    FRONTEND_DIST=/app/static \
    PORT=8080

RUN useradd --create-home --uid 10001 sima
WORKDIR /app
COPY --from=deps /opt/venv /opt/venv
# Only what the server needs. app/data keeps the static reference data
# (emission factors, CEA baseline, reference BOQs); editable data lives in the
# database (DATABASE_URL). The app writes there and to /tmp, so /app stays
# owned by sima for the local-files fallback.
COPY --chown=sima:sima backend/app ./app
COPY --chown=sima:sima backend/db ./db
COPY --chown=sima:sima --from=web /web/dist ./static

USER 10001
EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn app.server:root --host 0.0.0.0 --port ${PORT:-8080} --proxy-headers --forwarded-allow-ips '*' --no-server-header"]
