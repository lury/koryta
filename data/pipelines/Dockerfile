# The capture extractor (src/service), for Cloud Run - and the jobs (src/jobs),
# which run as Cloud Run jobs from this image with their own command: see
# src/jobs/CLOUD_RUN.md.
#
# Installs the pipelines package's base dependencies rather than a hand-picked
# subset: `oneshot.py` drives the pipeline modules directly, so it inherits
# their imports, and a trimmed list would break the next time one of them grew
# an import. The `ml` group — torch, spacy and the nvidia runtimes, 4.5 GB of
# the tree — is left out, which is where nearly all of the weight was.
FROM ghcr.io/astral-sh/uv:0.11.33-python3.13-trixie-slim AS builder

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv

WORKDIR /app

# `leveldb-export` is the one dependency resolved from a git url rather than a
# wheel, and the uv images are too slim to carry a git. Nothing the service
# imports reaches it — that is `scrapers.koryta.download`, reading the nightly
# Firestore export — but it is a base dependency of `pipelines`, and taking those
# wholesale is what this image does on purpose. Only this stage has git.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# Only the dependencies: the project itself is installed in the runtime stage,
# so the 1.5 GB venv layer does not change when the source does.
COPY pyproject.toml uv.lock README.md ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-default-groups --group service --no-install-project


# The same base as the builder, so the venv's python links resolve and no
# second image is pulled; git stays behind in the builder.
FROM ghcr.io/astral-sh/uv:0.11.33-python3.13-trixie-slim

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH=/app/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/src

WORKDIR /app

# The code and the venv belong to root and stay read-only. The user writes only
# its home (~/.cache/koryta, ~/.config) and the folders stores.config and the
# jobs write under /app.
RUN groupadd --system --gid 10001 koryta \
    && useradd --system --uid 10001 --gid koryta --create-home --home-dir /home/koryta koryta \
    && mkdir /app/versioned /app/downloaded /app/crawler_output /app/log \
    && chown koryta:koryta /app/versioned /app/downloaded /app/crawler_output /app/log

COPY --from=builder /app/.venv /app/.venv
COPY pyproject.toml uv.lock README.md ./
COPY src ./src
# Adds only the project (its .pth and console scripts) to the venv: every
# dependency is already there, so this needs no git. Then src is compiled,
# since the user cannot write __pycache__ under /app/src.
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-default-groups --group service \
    && python -m compileall -q /app/src

USER koryta:koryta

# Cloud Run sets $PORT; the default matches the `direct` dispatch mode the
# frontend uses in development.
ENV PORT=8081
CMD ["sh", "-c", "exec uvicorn service.app:app --host 0.0.0.0 --port ${PORT} --workers 1"]
