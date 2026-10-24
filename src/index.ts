import { WebSocket } from 'ws'
import { buildApp } from '#root/app'
import type { Logger } from '#root/application/logger'
import { loadConfig } from '#root/config'
import {
  createWebSocketDeviceSource,
  type SocketLike,
} from '#root/infrastructure/z2m-websocket-source'

const HOST = '0.0.0.0'

const createLogger = (): Logger => ({
  warn: (message, context): void => {
    if (context === undefined) {
      console.warn(message)
      return
    }
    console.warn(message, context)
  },
  error: (message, context): void => {
    if (context === undefined) {
      console.error(message)
      return
    }
    console.error(message, context)
  },
})

const describeError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  return 'unknown error'
}

const config = loadConfig(process.env)

const app = buildApp({
  source: createWebSocketDeviceSource({
    url: config.zigbee2mqttWsUrl,
    deadlineMs: config.scrapeDeadlineMs,
    createSocket: (url): SocketLike => new WebSocket(url),
    logger: createLogger(),
  }),
})

const start = async (): Promise<void> => {
  try {
    const address = await app.listen({ port: config.port, host: HOST })
    app.log.info(`Listening on ${address}`)
  } catch (error) {
    console.error(`Failed to listen on ${HOST}:${config.port}: ${describeError(error)}`)
    process.exit(1)
  }
}

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  app.log.info(`Received ${signal}, closing server`)
  await app.close()
  process.exit(0)
}

process.on('SIGTERM', (): void => {
  void shutdown('SIGTERM')
})

process.on('SIGINT', (): void => {
  void shutdown('SIGINT')
})

void start()
