# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- dependencies ---
# A single install for the whole workspace, cached on the lockfile alone so a source
# change does not re-resolve the dependency tree.
FROM node:22-alpine AS deps
RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
COPY packages/ai/package.json packages/ai/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile

# ----------------------------------------------------------------------- build ---
FROM deps AS build
WORKDIR /app
COPY . .

# The web build is static; the server bundle inlines the workspace packages (they
# export TypeScript source, so Node could not load them at runtime).
RUN pnpm -C apps/web build && pnpm -C apps/server build

# ------------------------------------------------------------- runtime modules ---
# Only what the server bundle still imports at runtime: fastify and its plugins.
FROM deps AS runtime-deps
WORKDIR /app
RUN pnpm --filter @truco/server --prod deploy /deploy --legacy

# --------------------------------------------------------------------- runtime ---
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
WORKDIR /app

# Run unprivileged; the image needs no write access to anything.
USER node

COPY --from=runtime-deps --chown=node:node /deploy/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/server/dist ./dist
# The built web app is served by the same process, from `dist/public`.
COPY --from=build --chown=node:node /app/apps/web/dist ./dist/public

EXPOSE 3000

# `wget` ships with the alpine base; a failing health check means the game loop is
# wedged, not merely that the port is open.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1

CMD ["node", "dist/main.js"]
