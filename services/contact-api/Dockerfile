# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1 — production dependencies only (nodemailer; nothing else).
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# ---------------------------------------------------------------------------
# Stage 2 — runtime
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    PORT=8081 \
    INQUIRY_LOG_PATH=/data/inquiries.jsonl

WORKDIR /app

# /data is the durable inquiry store. It is owned by the unprivileged `node`
# user (uid/gid 1000) so a bind mount only needs `chown 1000:1000` on the host.
RUN mkdir -p /data && chown node:node /data

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json server.mjs config.mjs validate.mjs store.mjs mailer.mjs ./

USER node

EXPOSE 8081

# No curl/wget in the image — Node 22 has global fetch, so the probe costs nothing.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8081)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# The service installs its own SIGTERM/SIGINT handlers, so it can run as PID 1.
CMD ["node", "server.mjs"]
