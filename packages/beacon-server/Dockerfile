FROM node:24-alpine

ARG BEACON_SERVER_VERSION=latest

ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    BEACON_STORE=sqlite \
    BEACON_SQLITE_PATH=/data/beacon.db

RUN npm install --global --no-fund --no-audit \
      "@snowseo/beacon-server@${BEACON_SERVER_VERSION}" pg \
 && addgroup -S beacon \
 && adduser -S beacon -G beacon \
 && mkdir -p /data \
 && chown -R beacon:beacon /data

USER beacon
WORKDIR /data
VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1

CMD ["beacon-server"]
