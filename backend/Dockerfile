FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Clean install deps
RUN npm ci --omit=dev --omit=optional && npm cache clean --force

FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache dumb-init

# Copy deps from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy app code
COPY . .
RUN rm -f .env .env.* && mkdir -p uploads/tickets

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S civilier -u 1001

# Change ownership
RUN chown -R civilier:nodejs /app
USER civilier

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/health/live', (r)=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))" || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
