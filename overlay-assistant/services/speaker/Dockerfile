FROM ghcr.io/astral-sh/uv:0.9.25 AS uv

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SPEAKER_SERVICE_HOST=0.0.0.0 \
    SPEAKER_SERVICE_PORT=8791 \
    LIVE_AI_PRIVATE_DATA_DIR=/data/private/speaker \
    HF_HOME=/models/huggingface

WORKDIR /app

COPY --from=uv /uv /uvx /bin/
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src

RUN uv sync --frozen --no-dev \
    && useradd --create-home --uid 10001 speaker \
    && mkdir -p /data/private/speaker /models/huggingface \
    && chown -R speaker:speaker /data /models

USER speaker

ENV PATH="/app/.venv/bin:${PATH}"

EXPOSE 8791
VOLUME ["/data/private/speaker", "/models"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8791/health', timeout=3)"]

CMD ["uvicorn", "live_ai_speaker.main:app", "--host", "0.0.0.0", "--port", "8791", "--workers", "1"]
