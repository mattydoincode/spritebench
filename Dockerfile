# Debian rather than Alpine on purpose: sharp ships prebuilt binaries for
# glibc, and on musl it falls back to compiling libvips from source.
#
# Every stage starts from the image itself rather than from a shared `base`
# stage. App Platform builds with kaniko, which derives a fresh cache key for a
# stage built on another stage on every build, so a shared base meant no RUN
# layer was ever reused -- `npm ci` reinstalled on every deploy with an
# unchanged lockfile.

# --- dependencies -----------------------------------------------------------
# Kept as its own stage so a source-only change does not reinstall anything.
FROM node:22-bookworm-slim AS deps
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# --- build ------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next reads NODE_ENV=production here, which is what we want for the client
# bundle. Nothing in the build talks to Postgres or R2.
RUN npm run build && npm run build:node

# --- production dependencies ------------------------------------------------
FROM node:22-bookworm-slim AS prod-deps
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# --- runtime ----------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Signals reach PID 1 directly, which is what makes the worker's graceful
# SIGTERM drain work under a container runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends dumb-init \
    && rm -rf /var/lib/apt/lists/*

# Owned by node because `next start` writes into .next/cache at runtime, and a
# root-owned tree makes that fail only once the container is already serving.
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/dist ./dist
# `next start` serves public/ from disk; it is not part of .next.
COPY --from=build --chown=node:node /app/public ./public
# Migrations are read from disk at release time, so they ship with the image.
COPY --from=build --chown=node:node /app/drizzle ./drizzle
# Declares every variable the app reads, and holds no credentials -- the panel
# supplies those, and an already-set variable wins over this file.
COPY --chown=node:node package.json next.config.mjs .env ./

USER node

ENV PORT=8080
EXPOSE 8080

# The web service. The worker service overrides this with:
#   node dist/worker.mjs
# and the release command runs:
#   node dist/migrate.mjs
#
# The binary is invoked directly rather than through npx so that SIGTERM
# reaches Next itself instead of a wrapper.
ENTRYPOINT ["dumb-init", "--"]
CMD ["node_modules/.bin/next", "start", "-p", "8080"]
