# syntax=docker/dockerfile:1

# ---------- build ----------
FROM node:24.22.1-alpine AS build

WORKDIR /app

# No corepack: pnpm is installed explicitly so the version is visible here.
RUN npm install -g pnpm@12.15.0

# Dependency manifests first, so the install layer survives source edits.
# pnpm-workspace.yaml is required too: pnpm 12 reads build-script approvals
# from it, and without it the frozen install fails on esbuild.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

# ---------- runtime ----------
FROM node:24.22.1-alpine

WORKDIR /app

RUN npm install -g pnpm@12.15.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Production dependencies only; the store is pruned so it does not ship.
RUN pnpm install --prod --frozen-lockfile && pnpm store prune

COPY --from=build /app/dist ./dist

# switch to user node (uid=1000)
USER node

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/index.js"]
