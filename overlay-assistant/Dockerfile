FROM node:22-slim AS deps
ARG PNPM_VERSION=11.7.0
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
WORKDIR /app
COPY . .
RUN pnpm -C packages/shared build \
 && pnpm -C apps/server build \
 && pnpm -C apps/web build

FROM node:22-slim AS runtime
ARG PNPM_VERSION=11.7.0
WORKDIR /app
ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps \
    PERSONAL_MEMORY_PATH=/app/data/private/personal_memory.local.json \
    SESSION_LOG_DIR=/app/data/private/sessions
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/src/db/migrations ./apps/server/dist/db/migrations
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/data/coaching ./data/coaching
COPY apps/server/package.json ./apps/server/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN groupadd --system appgroup \
 && useradd --system --gid appgroup --create-home appuser \
 && mkdir -p /app/data/private/sessions \
 && chown -R appuser:appgroup /app
USER appuser
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
EXPOSE 8080
CMD ["node", "apps/server/dist/index.js"]
