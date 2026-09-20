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
# logs as "Downloading cpython-3.13.4-linux-x86_64-gnu"). That standalone
# distribution's bundled ensurepip vendors an old setuptools/msgpack, which
# is what Trivy was actually flagging (GHSA-6v7p-g79w-8964, CVE-2025-47273)
# -- unrelated to any dependency version we pin ourselves, which is why
# bumping torch/torch_geometric didn't change the findings.
#
# UV_PYTHON=3.13 (minor only) overrides the repo's .python-version pin
# (3.13.4 exact) just for this image build -- the base image's system
# Python is a different 3.13.x patch, and only-system now requires an
# exact interpreter match rather than silently falling back to a managed
# download. Scoped to the Dockerfile so local dev's .python-version pin is
# untouched.

COPY --from=ghcr.io/astral-sh/uv:0.12.13 /uv /uvx /bin/

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
