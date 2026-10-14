# syntax=docker/dockerfile:1

# ---- build: Angular production build (browser + SSR server) --------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY angular.json tsconfig.json tsconfig.app.json ./
COPY public ./public
COPY src ./src
RUN npx ng build

# ---- runtime: the SSR server bundle is self-contained (no node_modules needed) ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=4000
COPY --from=build /app/dist/front-end ./dist
USER node
EXPOSE 4000
CMD ["node", "dist/server/server.mjs"]
