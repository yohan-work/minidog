# Two small runtime images from one build (context: repository root):
#   --target api   the Query/Ingestion API, bundled into a single file
#   --target web   the dashboard, as Next's standalone server
#   --target demo  a three-service demo shop that sends sample telemetry
FROM node:26-alpine AS build
ENV CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /src
# Manifests first, so dependency installs are cached until they change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/types/package.json packages/types/
COPY packages/config/package.json packages/config/
COPY examples/demo-shop/package.json examples/demo-shop/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @minidog/api build && pnpm --filter @minidog/web build && pnpm --filter @minidog/demo-shop build

FROM node:26-alpine AS api
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    SQLITE_PATH=/data/minidog.sqlite
WORKDIR /app
COPY --from=build /src/apps/api/dist ./
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 4000
CMD ["node", "--disable-warning=ExperimentalWarning", "index.mjs"]

FROM node:26-alpine AS web
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    API_URL=http://api:4000
WORKDIR /app
COPY --from=build /src/apps/web/.next/standalone ./
COPY --from=build /src/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

FROM node:26-alpine AS demo
ENV NODE_ENV=production \
    OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318 \
    DEMO_HOST_NAME=demo-shop
WORKDIR /app
COPY --from=build /src/examples/demo-shop/dist ./
USER node
CMD ["node", "main.mjs"]
