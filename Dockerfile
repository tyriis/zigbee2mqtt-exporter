FROM node:24.22.1-alpine AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN PNPM_VERSION=$(node -p 'require("./package.json").packageManager.split("@")[1]') \
  && npm install -g "pnpm@${PNPM_VERSION}"
RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

FROM node:24.22.1-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN PNPM_VERSION=$(node -p 'require("./package.json").packageManager.split("@")[1]') \
  && npm install -g "pnpm@${PNPM_VERSION}"
RUN pnpm install --prod --frozen-lockfile && pnpm store prune

COPY --from=build /app/dist ./dist

USER node

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/index.js"]
