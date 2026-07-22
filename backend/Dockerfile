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
RUN apt-get update && apt-get install -y --no-install-recommends coreutils \
    && pip install --no-cache-dir --no-index --find-links=/wheels -r requirements.txt \
    && rm -rf /wheels \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system wat2do \
    && useradd --system --gid wat2do --create-home wat2do

COPY --chown=wat2do:wat2do backend/ .
COPY --chown=wat2do:wat2do product-control.json /product-control.json

USER wat2do

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
