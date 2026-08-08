FROM node:22-alpine

WORKDIR /app

RUN mkdir -p /data /seed && chown -R node:node /app /data /seed

COPY --chown=node:node services/dashboard-api/package.json ./package.json
COPY --chown=node:node services/dashboard-api/server.mjs ./server.mjs
COPY --chown=node:node public/office-scout/data/listings.json /seed/office.json
COPY --chown=node:node public/deals/data/listings.json /seed/deals.json
COPY --chown=node:node public/jobs/data/listings.json /seed/jobs.json

USER node

ENV PORT=8082 \
    DATA_DIR=/data \
    SEED_DIR=/seed \
    MAX_BODY_BYTES=1048576 \
    MAX_LISTINGS_PER_WRITE=500 \
    MAX_FULL_FEED_LISTINGS=50000 \
    MAX_LISTING_DEPTH=64 \
    AUDIT_MAX_BYTES=5242880 \
    AUDIT_KEEP_FILES=3

EXPOSE 8082

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8082)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
