FROM python:3.13-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH" \
    UV_PYTHON_PREFERENCE=only-system \
    UV_PYTHON=3.13

COPY --from=ghcr.io/astral-sh/uv:0.12.13 /uv /uvx /bin/

# python:3.13-slim ships a preinstalled system pip that vendors an old
# msgpack and an old setuptools — both surfaced as Trivy CRITICAL/HIGH
# findings unrelated to anything this project actually depends on.
# Removing it is the actual fix (confirmed via local Trivy + filesystem
# inspection, not guessed) since uv never needs pip to install packages.
RUN rm -rf /usr/local/lib/python3.13/site-packages/pip* \
           /usr/local/lib/python3.13/ensurepip

COPY pyproject.toml uv.lock ./
RUN uv sync --locked --extra ml --no-dev --no-install-project

COPY . .
RUN uv sync --locked --extra ml --no-dev

EXPOSE 7860

CMD ["sh", "-c", "uvicorn vigilia.api.main:app --host 0.0.0.0 --port ${PORT:-7860}"]
