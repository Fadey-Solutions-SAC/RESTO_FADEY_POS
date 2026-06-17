# syntax=docker/dockerfile:1
# Imagen única: frontend (build estático) + API Node + API Python del bot SUNAT (puerto 8765).

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY scripts ./scripts
COPY client ./client
COPY server/printing/thermalPrintLayout.json ./server/printing/thermalPrintLayout.json
RUN npm run build

FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    ca-certificates \
    libxml2 \
    libxslt1.1 \
    libjpeg62-turbo \
    zlib1g \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY --from=builder /app/client/dist ./client/dist
COPY server/efact /app/bot

RUN python3 -m venv /app/bot/.venv \
  && /app/bot/.venv/bin/pip install --no-cache-dir --upgrade pip \
  && /app/bot/.venv/bin/pip install --no-cache-dir -r /app/bot/requirements.txt

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /data /data/efact-output

ENV NODE_ENV=production
ENV PORT=3001
ENV DB_PATH=/data/restaurant.db
ENV EFACT_HTTP_HOST=0.0.0.0
ENV EFACT_HTTP_PORT=8765
ENV OUTPUT_DIR=/data/efact-output

EXPOSE 3001 8765

ENTRYPOINT ["/entrypoint.sh"]
