# Build a single container that serves the API and static web build.
# For serious deployments, split web+api or use an ingress layer.

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm install

FROM deps AS build
WORKDIR /app
RUN npm run build -w packages/shared
RUN npm run build -w apps/server
RUN npm run build -w apps/web

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY apps/server/package.json ./apps/server/package.json
COPY packages/shared/package.json ./packages/shared/package.json
EXPOSE 8080
CMD ["node", "apps/server/dist/index.js"]
