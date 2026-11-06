FROM node:26.13.0-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216 AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN PNPM_VERSION=$(node -p 'require("./package.json").packageManager.split("@")[1]') \
  && npm install -g "pnpm@${PNPM_VERSION}"
RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

FROM node:26.13.0-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN PNPM_VERSION=$(node -p 'require("./package.json").packageManager.split("@")[1]') \
  && npm install -g "pnpm@${PNPM_VERSION}"
RUN pnpm install --prod --frozen-lockfile && pnpm store prune

COPY --from=build /app/dist ./dist

LABEL org.opencontainers.image.source="https://github.com/tyriis/zigbee2mqtt-exporter" \
      org.opencontainers.image.description="Prometheus exporter for Zigbee2MQTT device last-seen times" \
      org.opencontainers.image.licenses="MIT"

USER node

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/index.js"]
