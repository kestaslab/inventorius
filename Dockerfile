# Multi-stage Dockerfile for Proxmox VE LXC / Docker
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy built assets and dependencies
COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# Create persistent data directory for Proxmox mounts
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["npx", "serve", "-s", "dist", "-l", "3000"]
