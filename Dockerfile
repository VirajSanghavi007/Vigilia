# Full Argus deploy (incl. Predict tab + live rescore) — for Hugging Face Spaces (Docker SDK).
# HF free tier = 16GB RAM, so torch runs fine here (unlike Render free / 512MB).
FROM python:3.13-slim

WORKDIR /app
ENV PYTHONPATH=src \
    PYTHONUNBUFFERED=1 \
    UV_PROJECT_ENVIRONMENT=/usr/local

COPY --from=ghcr.io/astral-sh/uv:0.12.13 /uv /uvx /bin/

# Install from the SAME uv.lock that CI resolves and tests against — the
# CPU torch/torch_geometric extra included, so this image is exactly what
# smoke tests exercised, not a fresh `pip install` re-resolving against
# whatever's on PyPI/HF today.
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --extra ml --no-dev

# App code + the committed cache/model (datasets are excluded via .dockerignore)
COPY . .

# HF Spaces routes to port 7860 by default
EXPOSE 7860
CMD ["sh", "-c", "uvicorn backend.api.main:app --host 0.0.0.0 --port ${PORT:-7860}"]
