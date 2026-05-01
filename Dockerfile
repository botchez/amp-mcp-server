# syntax=docker/dockerfile:1.7

# --- builder ---------------------------------------------------------------
FROM node:20-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- runtime --------------------------------------------------------------
FROM node:20-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    MCP_HOST=0.0.0.0 \
    MCP_PORT=3000

# MCP_HOST=0.0.0.0 is required inside Docker so the published port works,
# but the server's safety guard refuses to start in 0.0.0.0 + MCP_AUTH_MODE=none
# + no MCP_ALLOWED_HOSTS unless MCP_ALLOW_INSECURE=true. Set MCP_AUTH_MODE
# (bearer/oauth) or MCP_ALLOWED_HOSTS in your .env before running.

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

USER node
EXPOSE 3000

# Liveness probe via /health — fetch() avoids needing curl in the slim image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.MCP_PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
