# syntax=docker/dockerfile:1.7

# ---------------------------------------------------------------- builder ---
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Copy manifests first so the dependency layer caches independently of source.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN npm ci

COPY . .
RUN npm run build

# Drop dev dependencies from the layer that ships.
RUN npm prune --omit=dev

# npm workspaces hoist every dependency to the root node_modules, so the
# per-workspace directory is usually empty and prune removes it outright.
# The runtime stage still COPYs it — for the case where a version conflict
# does force a local install — and COPY fails on a missing source, so ensure
# it exists. Without this the image build stops here.
RUN mkdir -p /app/apps/api/node_modules

# ---------------------------------------------------------------- runtime ---
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=4000 \
    NODE_OPTIONS="--max-old-space-size=512"

# Minimal runtime deps; tini gives us correct signal handling so SIGTERM
# reaches Node and the graceful-shutdown path actually runs.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Never run as root.
RUN groupadd --system --gid 1001 ruvik \
 && useradd --system --uid 1001 --gid ruvik ruvik

COPY --from=builder --chown=ruvik:ruvik /app/node_modules ./node_modules
COPY --from=builder --chown=ruvik:ruvik /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=ruvik:ruvik /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder --chown=ruvik:ruvik /app/apps/api/src/db/migrations ./apps/api/dist/db/migrations
COPY --from=builder --chown=ruvik:ruvik /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder --chown=ruvik:ruvik /app/package.json ./package.json

# Writable only where it must be.
RUN mkdir -p /app/storage && chown ruvik:ruvik /app/storage

USER ruvik
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=4s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/api/dist/server.js"]
