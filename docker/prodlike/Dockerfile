# syntax=docker/dockerfile:1.7
# The site as App Hosting runs it - a production `nuxt build` served by
# `node .output/server/index.mjs` - against the Firebase emulators instead of
# the koryta-pl project. See compose.prodlike.yaml at the repository root.

ARG NODE_IMAGE=node:24.22.3-bookworm-slim

# --- dependencies: the lockfile alone, so a code change keeps this layer ---
FROM ${NODE_IMAGE} AS deps
WORKDIR /repo/frontend
COPY frontend/package.json frontend/package-lock.json ./
# `postinstall` is `nuxt prepare`, which needs the sources; it runs in `build`.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts --no-audit --no-fund \
    && npm rebuild better-sqlite3 sharp esbuild

# --- build: the same `nuxt build` App Hosting runs, with the emulators baked
# into the client config (USE_EMULATORS), as `npm run dev:build` does ---
FROM deps AS build
COPY frontend/ ./
ENV NODE_OPTIONS=--max-old-space-size=4096 \
    USE_EMULATORS=true \
    NUXT_TELEMETRY_DISABLED=1
RUN npx nuxt prepare && npx nuxt build

# --- app: only the built server, read-only, as an unprivileged user ---
FROM ${NODE_IMAGE} AS app
WORKDIR /app
COPY --from=build /repo/frontend/.output ./.output
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    USE_EMULATORS=true \
    GCLOUD_PROJECT=demo-koryta-pl \
    FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
    FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/stats/database').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", ".output/server/index.mjs"]

# --- emulators: Firestore and Auth, listening beyond the container ---
# trixie for its Java 21, the oldest firebase-tools 15 starts the emulator on.
FROM node:24.22.3-trixie-slim AS emulators
RUN apt-get update \
    && apt-get install -y --no-install-recommends openjdk-21-jre-headless \
    && rm -rf /var/lib/apt/lists/*
# Kept in step with firebase-tools in frontend/package-lock.json.
ARG FIREBASE_TOOLS_VERSION=15.24.0
RUN --mount=type=cache,target=/root/.npm \
    npm install -g --no-audit --no-fund firebase-tools@${FIREBASE_TOOLS_VERSION}
# The emulator writes its debug logs into the working directory.
RUN mkdir -p /emulators /data && chown node:node /emulators /data
WORKDIR /emulators
COPY firestore.rules firestore.indexes.json ./
COPY docker/prodlike/firebase.json ./firebase.json
COPY docker/prodlike/emulators-start.sh /usr/local/bin/emulators-start
COPY docker/prodlike/named-db.js /usr/local/lib/named-db.js
USER node
RUN firebase setup:emulators:firestore >/dev/null && firebase setup:emulators:ui >/dev/null
EXPOSE 8080 9099 4000
VOLUME /data
# Exported on a clean stop and read back on start, so a large seed survives;
# logs of every run are kept in /data/logs.
CMD ["emulators-start"]
