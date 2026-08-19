FROM node:22-bookworm-slim AS builder
ENV NEXT_TELEMETRY_DISABLED=1
ENV TURBO_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/git/package.json ./apps/git/package.json
COPY apps/ssh/package.json ./apps/ssh/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/ai/package.json ./packages/ai/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/git/package.json ./packages/git/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
# Next's standalone tracer currently keeps only the CommonJS SWC helpers even
# though its server entry loads the ESM helper. Restore the complete package.
RUN swc_source="$(readlink -f /workspace/node_modules/.pnpm/node_modules/@swc/helpers)" \
  && swc_target="$(readlink -f /workspace/apps/web/.next/standalone/node_modules/.pnpm/node_modules/@swc/helpers)" \
  && rm -rf "$swc_target" \
  && mkdir -p "$(dirname "$swc_target")" \
  && cp -a "$swc_source" "$swc_target"
RUN pnpm --filter @northstar/git-server deploy --prod /deploy/git
RUN pnpm --filter @northstar/ssh-server deploy --prod /deploy/ssh
RUN pnpm --filter @northstar/worker deploy --prod /deploy/worker
RUN pnpm --filter @northstar/db deploy --prod /deploy/db

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV NODE_OPTIONS=--conditions=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM runtime AS web
WORKDIR /app
COPY --from=builder /workspace/apps/web/.next/standalone ./
COPY --from=builder /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /workspace/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

FROM runtime AS git
WORKDIR /app
COPY --from=builder /deploy/git ./
EXPOSE 4000
CMD ["node", "dist/index.js"]

FROM runtime AS worker
WORKDIR /app
COPY --from=builder /deploy/worker ./
CMD ["node", "dist/index.js"]

FROM runtime AS ssh
WORKDIR /app
COPY --from=builder /deploy/ssh ./
EXPOSE 2222
CMD ["node", "dist/index.js"]

FROM runtime AS migrate
WORKDIR /app
COPY --from=builder /deploy/db ./
CMD ["node", "dist/migrate.js"]

FROM runtime AS seed
WORKDIR /app
COPY --from=builder /deploy/db ./
CMD ["node", "dist/seed.js"]
