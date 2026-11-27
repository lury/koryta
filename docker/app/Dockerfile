# syntax=docker/dockerfile:1.7
# The site on Postgres, for a server of our own (compose.coolify.yaml,
# docs/postgres/README.md): the production `nuxt build`, and a `tools` image
# with the migrations and loaders for the one-shot `migrate` service.
#
#   docker buildx build --platform linux/amd64 -f docker/app/Dockerfile --target app .
#
# The build runs on the machine's own platform: under emulation Node runs
# without its JIT and `nuxt build` did not finish in an hour. Its output is
# JavaScript except for sharp's and better-sqlite3's binaries, which are
# fetched for the target platform and swapped in (`natives`).

ARG NODE_IMAGE=node:24.22.3-bookworm-slim

# --- dependencies for the build, on the build platform ---
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS deps
WORKDIR /repo/frontend
COPY frontend/package.json frontend/package-lock.json ./
# `postinstall` is `nuxt prepare`, which needs the sources; it runs in `build`.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts --no-audit --no-fund \
    && npm rebuild better-sqlite3 sharp esbuild

# --- build: the production build, App Check off (the demo's Firebase project
# has none); the Firebase web config is set at runtime ---
FROM deps AS build
COPY frontend/ ./
ARG FIREBASE_APP_CHECK=false
ENV NODE_OPTIONS=--max-old-space-size=4096 \
    NUXT_TELEMETRY_DISABLED=1 \
    FIREBASE_APP_CHECK=${FIREBASE_APP_CHECK}
RUN npx nuxt prepare && npx nuxt build

# --- natives: the build's output with the target platform's binaries ---
FROM ${NODE_IMAGE} AS natives
WORKDIR /natives
COPY --from=build /repo/frontend/.output /app/.output
RUN --mount=type=cache,target=/root/.npm \
    set -eu; \
    modules=/app/.output/server/node_modules; \
    sharp=$(node -p "require('$modules/sharp/package.json').version"); \
    sqlite=$(node -p "require('$modules/better-sqlite3/package.json').version"); \
    npm init -y >/dev/null; \
    npm install --no-audit --no-fund --no-save "sharp@$sharp" "better-sqlite3@$sqlite"; \
    rm -rf "$modules/@img"; \
    cp -r node_modules/@img "$modules/@img"; \
    cp node_modules/better-sqlite3/build/Release/better_sqlite3.node \
       "$modules/better-sqlite3/build/Release/better_sqlite3.node"; \
    node -e "for (const f of process.argv.slice(1)) process.dlopen({ exports: {} }, f)" \
       "$modules/better-sqlite3/build/Release/better_sqlite3.node" \
       $(find "$modules/@img" -name 'sharp-*.node')

# --- app: only the built server, read-only, as an unprivileged user ---
FROM ${NODE_IMAGE} AS app
WORKDIR /app
COPY --from=natives /app/.output ./.output
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
USER node
EXPOSE 3000
# Through Postgres, so an unreachable database fails the check.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/nodes?type=region&limit=1').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", ".output/server/index.mjs"]

# --- tools: migrations, the seed and the loaders, run once per deploy, on
# the target platform (tsx runs esbuild's binary) ---
FROM ${NODE_IMAGE} AS tools
WORKDIR /repo/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts --no-audit --no-fund
COPY frontend/server/db ./server/db
# The recount the loader runs after a load (server/db/batch.ts) shares its
# helpers with the Firestore handler.
COPY frontend/server/utils ./server/utils
COPY frontend/shared ./shared
COPY frontend/scripts ./scripts
ENV NODE_ENV=production
USER node
CMD ["npx", "tsx", "scripts/pg/demo-init.ts"]
