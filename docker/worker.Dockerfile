FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY --from=build /app .
CMD ["pnpm", "--filter", "@gip/worker", "start"]
