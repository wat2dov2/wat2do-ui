# --- Dependency stage ---
FROM node:22-slim AS dependencies

WORKDIR /workspace/frontend

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci

# --- Build stage ---
FROM node:22-slim AS build

WORKDIR /workspace/frontend

COPY --from=dependencies /workspace/frontend/node_modules ./node_modules
COPY frontend/package.json frontend/package-lock.json* ./
COPY frontend/ .
COPY product-control.json /workspace/product-control.json

ARG NEXT_PUBLIC_API_URL=/api
ARG API_REWRITE_URL=http://127.0.0.1:8000
ARG BACKEND_API_URL=http://127.0.0.1:8000
ARG NEXT_PUBLIC_MAPBOX_TOKEN
ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
ARG NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
ARG NEXT_PUBLIC_POSTHOG_HOST
ARG APP_VERSION
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV API_REWRITE_URL=${API_REWRITE_URL}
ENV BACKEND_API_URL=${BACKEND_API_URL}
ENV NEXT_PUBLIC_MAPBOX_TOKEN=${NEXT_PUBLIC_MAPBOX_TOKEN}
ENV NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=${NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}
ENV NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=${NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN}
ENV NEXT_PUBLIC_POSTHOG_HOST=${NEXT_PUBLIC_POSTHOG_HOST}
ENV APP_VERSION=${APP_VERSION}

RUN npm run build

# --- Production stage ---
FROM node:22-slim AS runtime

WORKDIR /app/frontend

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN groupadd --system nextjs && useradd --system --gid nextjs --create-home nextjs

COPY --from=build --chown=nextjs:nextjs /workspace/frontend/.next/standalone /app
COPY --from=build --chown=nextjs:nextjs /workspace/frontend/public ./public
COPY --from=build --chown=nextjs:nextjs /workspace/frontend/.next/static ./.next/static

RUN mkdir -p .next/cache /tmp && chown -R nextjs:nextjs /app /tmp

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
