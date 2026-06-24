# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# Stylique Fashion — Shopify App (Remix + custom Express server)
# Build context: repo root (fashion/)
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: base ─────────────────────────────────────────────────────────────
FROM node:20-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# ── Stage 2: deps (full workspace install) ────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json .npmrc ./
COPY apps/shopify-app/package.json apps/shopify-app/
COPY apps/worker/package.json      apps/worker/
COPY apps/web/package.json         apps/web/
COPY apps/widget/package.json      apps/widget/
COPY packages/                     packages/
RUN pnpm install --frozen-lockfile

# ── Stage 3: build ────────────────────────────────────────────────────────────
FROM deps AS builder
COPY apps/ apps/
# Prisma client (schema lives in packages/db/prisma)
RUN pnpm --filter @stylique/db exec prisma generate --schema=prisma/schema.prisma
# Storefront Mira is a separate browser bundle served by this app at /widget.js.
# Build and verify it before Remix so production images cannot ship stale Mira UI.
RUN pnpm --filter @stylique/widget build && pnpm --filter @stylique/widget verify:bundle
# Remix build → apps/shopify-app/build/{client,server}
RUN pnpm --filter @stylique/shopify-app build

# ── Stage 4: runner ───────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
ENV HOST=0.0.0.0
WORKDIR /app

# tsx runs the custom TypeScript Express server directly (no separate compile step)
RUN npm install -g tsx

# Copy workspace runtime
COPY --from=builder /app/package.json        ./package.json
COPY --from=builder /app/pnpm-lock.yaml      ./pnpm-lock.yaml
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/node_modules        ./node_modules
COPY --from=builder /app/packages            ./packages
COPY --from=builder /app/apps/shopify-app    ./apps/shopify-app

# server.ts uses relative paths (./build, ./public) → run from the app dir
WORKDIR /app/apps/shopify-app
EXPOSE 3000

# Custom Express server (raises body limits, validates env, attaches request IDs)
CMD ["tsx", "server.ts"]
