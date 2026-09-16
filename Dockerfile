# syntax=docker/dockerfile:1
FROM node:20-bookworm-slim

WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy server code, prebuilt WASM engine, Web UI, and scripts
COPY server.js ./
COPY lib/ ./lib/
COPY pkg/ ./pkg/
COPY web/ ./web/
COPY scripts/tls-ip-sni-fix.js ./scripts/tls-ip-sni-fix.js

ENV NODE_ENV=production \
    PORT=8080
EXPOSE 8080

USER node

CMD ["node", "-r", "./scripts/tls-ip-sni-fix.js", "server.js"]
