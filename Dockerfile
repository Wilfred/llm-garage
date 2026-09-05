# Multi-stage build for the llm-garage harness app.

# Build: compile TypeScript
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
ARG GIT_COMMIT=unknown
ARG BUILD_TIME
RUN node -e 'require("node:fs").writeFileSync("build-info.json", JSON.stringify({ gitCommit: process.env.GIT_COMMIT === "unknown" ? null : process.env.GIT_COMMIT, imageBuildTime: process.env.BUILD_TIME || new Date().toISOString() }))'

# Production dependencies only
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Runtime
FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DATA_DIR=/app/data
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/build-info.json ./build-info.json
COPY package.json ./
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME ["/app/data"]
USER node
EXPOSE 3000
CMD ["node", "dist/server/index.js"]
