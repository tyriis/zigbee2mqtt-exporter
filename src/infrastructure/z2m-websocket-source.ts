import type { Logger } from '#root/application/logger'
import type { DeviceSource, CollectResult } from '#root/application/device-source'
import { createLastSeenCollector } from '#root/application/last-seen-collector'
import { parseFrame } from '#root/infrastructure/message-parsing'

export interface SocketLike {
  on(event: 'message', listener: (data: unknown) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'close', listener: () => void): unknown
  close(): void
}

export type SocketFactory = (url: string) => SocketLike

export interface WebSocketSourceOptions {
  url: string
  deadlineMs: number
  createSocket: SocketFactory
  logger: Logger
}

const describeError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  return 'unknown error'
}

export const createWebSocketDeviceSource = (options: WebSocketSourceOptions): DeviceSource => ({
  collect: (): Promise<CollectResult> =>
    new Promise<CollectResult>((resolve): void => {
      const collector = createLastSeenCollector(options.logger)
      let socket: SocketLike | undefined
      let settled = false

      const settle = (result: CollectResult): void => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        socket?.close()
        resolve(result)
      }

      const timer = setTimeout((): void => {
        settle({
          ok: false,
          reason: 'timeout',
          message: `no complete device snapshot within ${options.deadlineMs}ms`,
        })
      }, options.deadlineMs)

      try {
        socket = options.createSocket(options.url)
      } catch (error) {
        settle({ ok: false, reason: 'source-error', message: describeError(error) })
        return
      }

      socket.on('message', (data: unknown): void => {
        if (settled) {
          return
        }
        const message = parseFrame(data)
        if (message === undefined) {
          options.logger.warn('Discarding malformed Zigbee2MQTT frame')
          return
        }
        const result = collector.handle(message)
        if (result.status === 'complete') {
          settle({ ok: true, lastSeen: result.lastSeen })
        }
      })

      socket.on('error', (error: Error): void => {
        settle({ ok: false, reason: 'source-error', message: error.message })
      })

      socket.on('close', (): void => {
        settle({ ok: false, reason: 'source-error', message: 'socket closed before completion' })
      })
    }),
})
