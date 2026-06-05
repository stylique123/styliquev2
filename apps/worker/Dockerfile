# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# Stylique Fashion — Background Worker (BullMQ + tsx)
# Build context: repo root (fashion/)
# Mirrors the shopify-app Dockerfile lessons (see RAILWAY_DEPLOY.md §3):
#   pin pnpm · install openssl (Prisma) · copy .npmrc (node-linker=hoisted) ·
#   copy ALL workspace package.jsons (frozen-lockfile needs them).
# ─────────────────────────────────────────────────────────────────────────────

FROM node:20-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# Full workspace install — copy every workspace member's manifest + .npmrc
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json .npmrc ./
COPY apps/shopify-app/package.json apps/shopify-app/
COPY apps/worker/package.json      apps/worker/
COPY apps/web/package.json         apps/web/
COPY apps/widget/package.json      apps/widget/
COPY packages/                     packages/
RUN pnpm install --frozen-lockfile

# Prisma client (schema lives in packages/db/prisma)
RUN pnpm --filter @stylique/db exec prisma generate --schema=prisma/schema.prisma

# Worker source
COPY apps/worker/ apps/worker/

ENV NODE_ENV=production
ENV WORKER_HEALTH_PORT=3001
EXPOSE 3001

# tsx runs the TypeScript worker directly (no separate tsc build step)
CMD ["pnpm", "--filter", "@stylique/worker", "start"]
