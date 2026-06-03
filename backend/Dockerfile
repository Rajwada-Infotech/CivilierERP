# ── Stage 1: Install production deps ──────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production --no-optional && npm cache clean --force

# ── Stage 2: Runtime ───────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Copy production deps from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy app source (migrations excluded via .dockerignore)
COPY . .

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S civilier -u 1001 && \
    mkdir -p /app/backend/uploads/tickets && \
    chown -R civilier:nodejs /app

USER civilier

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/health/live || exit 1

CMD ["node", "server.js"]
