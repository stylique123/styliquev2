# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# Stylique demo storefront (apps/web, Next.js 15) — deployed AS the live store.
# Build context: repo root (fashion/). Uses `next start` (not standalone) to
# avoid Next's standalone+Prisma tracing pain — reliable, full node_modules.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# Workspace install (all manifests + .npmrc so node-linker=hoisted applies)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json .npmrc ./
COPY apps/web/package.json        apps/web/
COPY apps/shopify-app/package.json apps/shopify-app/
COPY apps/worker/package.json     apps/worker/
COPY apps/widget/package.json     apps/widget/
COPY packages/                    packages/
RUN pnpm install --frozen-lockfile

# Prisma client (the demo's admin pages query it)
RUN pnpm --filter @stylique/db exec prisma generate --schema=prisma/schema.prisma

# Build the Next app
COPY apps/web apps/web
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @stylique/web build

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001
CMD ["pnpm", "--filter", "@stylique/web", "start"]
