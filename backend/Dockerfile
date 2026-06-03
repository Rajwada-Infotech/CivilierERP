# ── Stage 1: Install production deps ──────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
# Clean install — omit dev and optional deps for a lean production image
RUN npm ci --omit=dev --omit=optional && npm cache clean --force

# ── Stage 2: Runtime ───────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache dumb-init
# Copy deps from builder
COPY --from=builder /app/node_modules ./node_modules
# Copy app source (migrations excluded via .dockerignore)
COPY . .
RUN rm -f .env .env.* && mkdir -p uploads/tickets
# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S civilier -u 1001 && \
    mkdir -p /app/backend/uploads/tickets && \
    chown -R civilier:nodejs /app
USER civilier
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/health/live || exit 1
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
