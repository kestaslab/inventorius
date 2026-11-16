# Multi-stage Dockerfile for Proxmox VE / Docker (aligned with bun.lock + Node.js server.ts)
FROM oven/bun:1-alpine AS bun-bin

FROM node:22-alpine AS builder
COPY --from=bun-bin /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

FROM node:22-alpine AS runner
RUN apk add --no-cache curl bash tar
COPY --from=bun-bin /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

# Install production runtime dependencies strictly matching bun.lock (includes tsx, express, etc.)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy compiled SPA bundle and full-stack Express/API server sources
COPY --from=builder /app/dist ./dist
COPY server.ts tsconfig.json ./
COPY src/server ./src/server
COPY src/utils ./src/utils
COPY src/types ./src/types
COPY src/data ./src/data
COPY scripts ./scripts

RUN mkdir -p /app/data/photos /app/data/backups

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# SVARBU: serveris privalo veikti kaip vienas procesas (1 replika / 1 darbininkas), nes DB failas ir mutex yra šio proceso atmintyje.
CMD ["bun", "run", "start"]
