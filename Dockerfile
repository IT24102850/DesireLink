# ---- build: install everything, build the SPA ----------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_CONTACT_EMAIL
ENV VITE_CONTACT_EMAIL=${VITE_CONTACT_EMAIL}
RUN npm run build

# ---- runtime: production deps only, non-root ------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY shared ./shared
COPY scripts/create-admin.js scripts/docker-start.sh scripts/seed-bulk.js scripts/check-seed.js ./scripts/
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown -R node:node /data
# Starts as root only to chown the mounted disk, then drops to "node" (see docker-start.sh).
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# tini is started by docker-start.sh after dropping to the "node" user.
CMD ["sh", "scripts/docker-start.sh"]
