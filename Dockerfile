# Full Argus deploy (incl. Predict tab + live rescore) — for Hugging Face Spaces (Docker SDK).
# HF free tier = 16GB RAM, so torch runs fine here (unlike Render free / 512MB).
FROM python:3.13-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH" \
    UV_PYTHON_PREFERENCE=only-system \
    UV_PYTHON=3.13

# Without UV_PYTHON_PREFERENCE, `uv sync` ignores this image's own Python
# and downloads its own standalone CPython build instead (visible in build
# logs as "Downloading cpython-3.13.4-linux-x86_64-gnu") -- an unnecessary
# extra ~33MB and a second Python in the image. UV_PYTHON=3.13 (minor only)
# overrides the repo's .python-version pin (3.13.4 exact) just for this
# build, since the base image's system Python is a different 3.13.x patch
# and only-system requires an exact match rather than falling back to a
# download. Scoped to the Dockerfile so local dev's .python-version pin is
# untouched.

COPY --from=ghcr.io/astral-sh/uv:0.12.13 /uv /uvx /bin/

# python:3.13-slim ships a preinstalled system pip (confirmed by exporting
# the built image and inspecting its filesystem directly --
# /usr/local/lib/python3.13/site-packages/pip-26.2.1.dist-info -- rather
# than guessing from Trivy's output, which reported the bare aggregate
# target "Python" with no file path). pip vendors its own copy of msgpack
# (pip/_vendor/msgpack) at a version behind the latest fix
# (GHSA-6v7p-g79w-8964) and is the actual source of the setuptools finding
# too (CVE-2025-47273) -- neither is anything we install or pin ourselves;
# two earlier fix attempts (bumping torch/torch_geometric, then forcing uv
# onto this same system Python) didn't touch it because neither addressed
# pip's presence. We never invoke pip -- uv manages /app/.venv entirely --
# so it's dead weight, not a dependency; strip it before it's scanned.
RUN rm -rf /usr/local/lib/python3.13/site-packages/pip* \
           /usr/local/lib/python3.13/ensurepip

# Install from the SAME uv.lock that CI resolves and tests against — the
# CPU torch/torch_geometric extra included, so this image is exactly what
# smoke tests exercised, not a fresh `pip install` re-resolving against
# whatever's on PyPI/HF today.
# Two-pass sync so dependency install (slow) is cached separately from the
# local `vigilia` package build (fast, changes every commit):
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --extra ml --no-dev --no-install-project

COPY . .
RUN uv sync --locked --extra ml --no-dev

# HF Spaces routes to port 7860 by default
EXPOSE 7860
CMD ["sh", "-c", "uvicorn vigilia.api.main:app --host 0.0.0.0 --port ${PORT:-7860}"]
