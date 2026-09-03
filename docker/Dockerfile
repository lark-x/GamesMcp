# syntax=docker/dockerfile:1

# 1. Base stage
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
WORKDIR /app
RUN corepack enable && pnpm config set store-dir /pnpm/store

# 2. Manifests stage (copies only package manifests for optimal caching)
FROM base AS manifests
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/mcp-server/package.json ./apps/mcp-server/
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY packages/config/package.json ./packages/config/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/database/package.json ./packages/database/
COPY packages/domain/package.json ./packages/domain/
COPY packages/ingestion/package.json ./packages/ingestion/
COPY packages/providers/package.json ./packages/providers/
COPY packages/qa/package.json ./packages/qa/
COPY packages/retrieval/package.json ./packages/retrieval/
COPY packages/search/package.json ./packages/search/

# 3. Dependencies stage (cached via BuildKit pnpm store)
FROM base AS deps
WORKDIR /app
COPY --from=manifests /app /app
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# 4. Shared Packages Source stage
FROM deps AS pkg-source
WORKDIR /app
COPY tsconfig.base.json ./
COPY packages/ ./packages/

# 5. API build stage (targeted source, build & pruned prod dependencies)
FROM pkg-source AS api-source
WORKDIR /app
COPY apps/api/ ./apps/api/

FROM api-source AS api-build
WORKDIR /app
RUN pnpm --filter @gip/api... build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @gip/api deploy --legacy --prod /prod/api

# 6. Worker build stage (targeted source, build & pruned prod dependencies)
FROM pkg-source AS worker-source
WORKDIR /app
COPY apps/worker/ ./apps/worker/

FROM worker-source AS worker-build
WORKDIR /app
RUN pnpm --filter @gip/worker... build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @gip/worker deploy --legacy --prod /prod/worker

# 7. Web build stage (targeted source & web build)
FROM pkg-source AS web-source
WORKDIR /app
COPY apps/web/ ./apps/web/

FROM web-source AS web-build
WORKDIR /app
RUN pnpm --filter @gip/web... build

# 8. API Runtime stage
FROM node:22-bookworm-slim AS api-runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=api-build /prod/api /app
EXPOSE 4100
CMD ["node", "dist/server.js"]

# 9. Worker Runtime stage
FROM node:22-bookworm-slim AS worker-runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=worker-build /prod/worker /app
CMD ["node", "dist/index.js"]

# 10. Web Runtime stage
FROM nginx:1.27-alpine AS web-runtime
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
