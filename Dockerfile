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

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

USER node
EXPOSE 3000

CMD ["node", "dist/index.js"]
