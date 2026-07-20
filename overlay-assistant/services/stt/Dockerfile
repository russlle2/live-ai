FROM ghcr.io/astral-sh/uv:0.11.30 AS uv

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    LOCAL_STT_HOST=0.0.0.0 \
    LOCAL_STT_PORT=8178 \
    LIVE_RHETORIC_PRIVATE_DATA_DIR=/data/private \
    HF_HOME=/models/huggingface

WORKDIR /app

COPY --from=uv /uv /uvx /bin/
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src

RUN uv sync --frozen --no-dev \
    && useradd --create-home --uid 10002 stt \
    && mkdir -p /data/private/stt /models/huggingface \
    && chown -R stt:stt /data /models

USER stt

ENV PATH="/app/.venv/bin:${PATH}"

EXPOSE 8178
VOLUME ["/data/private/stt", "/models"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8178/health', timeout=3)"]

CMD ["uvicorn", "live_rhetoric_stt.main:app", "--host", "0.0.0.0", "--port", "8178", "--workers", "1"]
