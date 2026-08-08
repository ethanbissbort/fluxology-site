# =============================================================================
# fluxology-mcp — write-capable MCP connector
# =============================================================================
# Build context is the repository root: the image copies the canonical dashboard
# JSON Schemas at build time so there is never a second hand-maintained copy of
# the feed contracts (SDD §12.1).
#
#   docker compose build mcp
#
# The container publishes no host port. The VPS edge proxy reaches it by
# container DNS name on the external `fluxology-edge` network.
# =============================================================================
FROM node:22-alpine

WORKDIR /app

RUN mkdir -p /app/schemas && chown -R node:node /app

COPY --chown=node:node services/fluxology-mcp/package.json ./package.json
COPY --chown=node:node services/fluxology-mcp/package-lock.json ./package-lock.json

# Reproducible install from the pinned lockfile: MCP protocol support moves
# through reviewed releases, never through a floating dependency (SDD §8.2).
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --chown=node:node services/fluxology-mcp/src ./src

# Canonical feed contracts, compiled with Ajv at startup.
COPY --chown=node:node public/office-scout/data/schema.json /app/schemas/office.json
COPY --chown=node:node public/deals/data/schema.json /app/schemas/deals.json
COPY --chown=node:node public/jobs/data/schema.json /app/schemas/jobs.json

USER node

ENV NODE_ENV=production \
    PORT=8083 \
    MCP_SCHEMA_DIR=/app/schemas \
    DASHBOARD_API_URL=http://fluxology-dashboard-api:8082

EXPOSE 8083

# Readiness covers schemas, authorization-server metadata, Dashboard API
# reachability and feed schema drift (SDD §19.3).
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8083)+'/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.mjs"]
