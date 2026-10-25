FROM node:26.12.1-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN PNPM_VERSION=$(node -p 'require("./package.json").packageManager.split("@")[1]') \
  && npm install -g "pnpm@${PNPM_VERSION}"
RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

FROM node:26.12.1-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797

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
