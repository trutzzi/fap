# syntax=docker/dockerfile:1

# ---- deps: all dependencies + generated Prisma client -------------------------
FROM node:22-alpine AS deps
WORKDIR /app
# Prisma's schema engine (migrations) needs OpenSSL on Alpine.
RUN apk add --no-cache openssl
# `prisma generate` (postinstall) reads prisma.config.ts, which requires a URL; it never
# connects during the build.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.npm npm ci

# ---- build: compile TypeScript -------------------------------------------------
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# ---- tools: migrations and the user:* scripts (has the Prisma CLI and tsx) -------
FROM build AS tools
ENV NODE_ENV=production
CMD ["npx", "prisma", "migrate", "deploy"]

# ---- runtime: production dependencies + compiled code only ------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
