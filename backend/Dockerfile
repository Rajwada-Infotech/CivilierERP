# ── Stage 1: Install production deps ──────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
# Clean install — omit dev and optional deps for a lean production image
RUN npm ci --omit=dev --omit=optional && npm cache clean --force

# ── Stage 2: Runtime ───────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache dumb-init
# Pinned so builds stay reproducible; also silences the "new major version of
# npm available" notice printed on every `npm run migrate` during deploys.
# npm 12 needs Node ^22.22.2, which node:22-alpine already satisfies.
RUN npm install -g npm@12.1.0 && npm cache clean --force
# Copy deps from builder
COPY --from=builder /app/node_modules ./node_modules
# Copy app source (migrations excluded via .dockerignore)
COPY . .
RUN rm -f .env .env.*
# Create non-root user and fix ownership
# uploads/vault is the only disk-based upload dir (document vault uses diskStorage).
# Ticket uploads use multer memoryStorage — no directory needed.
RUN addgroup -g 1001 -S nodejs && \
    adduser -S civilier -u 1001 && \
    mkdir -p /app/uploads/vault && \
    chown -R civilier:nodejs /app
USER civilier
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/health/live || exit 1
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
