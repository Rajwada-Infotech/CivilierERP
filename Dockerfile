# ── Stage 1: Build ────────────────────────────────────────────────────────────
# Node 24, as CI builds with: eslint's @humanfs packages need >=24 (a Node 22 install printed EBADENGINE warnings).
# Only this stage changes; it just builds the static site that nginx serves below.
FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files and install ALL deps (including devDeps for build)
COPY package*.json ./
RUN npm ci --no-optional && npm cache clean --force

# Copy source and build
COPY . .
RUN npm run build

# ── Stage 2: Serve via nginx ───────────────────────────────────────────────────
FROM nginx:alpine

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config (already exists in repo root)
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
