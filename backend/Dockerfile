# Sima backend (FastAPI). Build context: ./backend
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Dependencies first, so code changes don't re-install them.
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
COPY db ./db
COPY scripts ./scripts

# Run as a non-root user. /app/app/data stays writable for local-file mode.
RUN useradd --create-home --uid 10001 sima && chown -R sima:sima /app
USER sima

# Hosts such as Render inject $PORT; locally it defaults to 8000.
ENV PORT=8000
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD python -c "import os,urllib.request;urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT','8000'), timeout=4)"

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
