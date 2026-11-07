# The Rust API server (rust/, binary wat2do-api) answers on port 8000 and runs
# the FastAPI app behind it on loopback until every router is ported.

FROM rust:1-slim-bookworm AS rust-chef

# The crate's ingestion half links BoringSSL (wreq) and aws-lc, which build with
# cmake, a C++ compiler and libclang, and BoringSSL applies its patches with git;
# the API binary itself does not use them. Bookworm's glibc is no newer than the
# Python runtime image's, so the binary runs there.
RUN apt-get update && apt-get install -y --no-install-recommends \
    clang \
    cmake \
    g++ \
    git \
    libclang-dev \
    make \
    perl \
    && rm -rf /var/lib/apt/lists/* \
    && cargo install cargo-chef --locked --version 0.1.78

WORKDIR /src/rust

FROM rust-chef AS rust-plan
COPY rust/ .
RUN cargo chef prepare --recipe-path recipe.json

FROM rust-chef AS rust-build
# Dependencies are their own layer, rebuilt only when Cargo.lock changes.
COPY --from=rust-plan /src/rust/recipe.json recipe.json
RUN cargo chef cook --release --locked --bin wat2do-api --recipe-path recipe.json
COPY rust/ .
# Files the crate embeds at build time.
COPY backend/controlbox/ /src/backend/controlbox/
COPY backend/schemas/event_discovery_fields.json /src/backend/schemas/event_discovery_fields.json
COPY backend/services/ingestion/prompt.md /src/backend/services/ingestion/prompt.md
COPY backend/services/ingestion/directory_prompt.md /src/backend/services/ingestion/directory_prompt.md
COPY backend/services/scraper/extraction_prompt.txt /src/backend/services/scraper/extraction_prompt.txt
COPY backend/services/wat2do-logo.png /src/backend/services/wat2do-logo.png
RUN cargo build --release --locked --bin wat2do-api \
    && cp target/release/wat2do-api /usr/local/bin/wat2do-api

FROM python:3.12-slim AS build

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip wheel --no-cache-dir --wheel-dir /wheels -r requirements.txt

FROM python:3.12-slim AS runtime

WORKDIR /app

COPY --from=build /wheels /wheels
COPY backend/requirements.txt .
RUN apt-get update && apt-get install -y --no-install-recommends \
    coreutils \
    fonts-dejavu-core \
    && pip install --no-cache-dir --no-index --find-links=/wheels -r requirements.txt \
    && rm -rf /wheels \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system wat2do \
    && useradd --system --gid wat2do --create-home wat2do

COPY --from=rust-build /usr/local/bin/wat2do-api /usr/local/bin/wat2do-api
COPY --chown=wat2do:wat2do backend/ .

USER wat2do

EXPOSE 8000

# PID 1: serves port 8000, runs uvicorn on loopback, and exits when it exits.
CMD ["wat2do-api", "serve"]
