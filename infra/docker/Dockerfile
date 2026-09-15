# One image for always-on mode: the api and web services run it with different
# commands (see compose.yaml). Build context is the repository root.
FROM node:24-slim

ENV CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile

# The dashboard bakes the API address into its /api rewrite at build time.
ARG API_URL=http://api:4000
RUN API_URL=$API_URL pnpm --filter @minidog/web build
