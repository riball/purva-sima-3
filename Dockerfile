# Sima -- ONE image serving the API and the web app. Build context: the repository root.
#   docker build -t sima .   &&   docker run -p 8000:8000 --env-file backend/.env sima
#   -> http://localhost:8000  (app)   http://localhost:8000/api/docs  (API docs)

# ---- 1. build the React app (API calls go to /api on the same address) ----
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
ENV VITE_API_BASE=/api
RUN npm run build

# ---- 2. the API, with the built app alongside ----
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    FRONTEND_DIST=/app/static

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install -r requirements.txt

COPY backend/app ./app
COPY backend/db ./db
COPY backend/scripts ./scripts
COPY --from=web /web/dist ./static

RUN useradd --create-home --uid 10001 sima && chown -R sima:sima /app
USER sima

# Hosts such as Render inject $PORT; locally it defaults to 8000.
ENV PORT=8000
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD python -c "import os,urllib.request;urllib.request.urlopen('http://127.0.0.1:%s/api/health' % os.environ.get('PORT','8000'), timeout=4)"

CMD ["sh", "-c", "uvicorn app.server:root --host 0.0.0.0 --port ${PORT:-8000}"]
