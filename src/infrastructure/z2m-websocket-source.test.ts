import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Logger } from '#root/application/logger'
import type { SocketLike } from '#root/infrastructure/z2m-websocket-source'
import { createWebSocketDeviceSource } from '#root/infrastructure/z2m-websocket-source'

interface SocketHarness {
  socket: SocketLike
  emitMessage: (data: unknown) => void
  emitError: (error: Error) => void
  emitClose: () => void
  closeCalls: () => number
}

const createSocketHarness = (): SocketHarness => {
  const messageListeners: ((data: unknown) => void)[] = []
  const errorListeners: ((error: Error) => void)[] = []
  const closeListeners: (() => void)[] = []
  let closes = 0

  const socket = {
    on: (event: string, listener: unknown): unknown => {
      if (event === 'message') {
        messageListeners.push(listener as (data: unknown) => void)
      } else if (event === 'error') {
        errorListeners.push(listener as (error: Error) => void)
      } else {
        closeListeners.push(listener as () => void)
      }
      return socket
    },
    close: (): void => {
      closes += 1
    },
  } as unknown as SocketLike

  return {
    socket,
    emitMessage: (data): void => messageListeners.forEach((listener) => listener(data)),
    emitError: (error): void => errorListeners.forEach((listener) => listener(error)),
    emitClose: (): void => closeListeners.forEach((listener) => listener()),
    closeCalls: (): number => closes,
  }
}

const createLoggerSpy = (): { logger: Logger; warn: ReturnType<typeof vi.fn<Logger['warn']>> } => {
  const warn = vi.fn<Logger['warn']>()
  return { logger: { warn, error: vi.fn<Logger['error']>() }, warn }
}

const throwNonErrorObject = (): never => {
  // Error-shaped, but not an Error instance: the adapter must not trust the shape
  const notAnError: Error = { name: 'Error', message: 'not a real error' }
  throw notAnError
}

const seedFrame = (): string =>
  JSON.stringify({ topic: 'bridge/devices', payload: [{ friendly_name: 'lamp', type: 'Router' }] })

const reportFrame = (): string =>
  JSON.stringify({ topic: 'lamp', payload: { last_seen: '2026-01-01T00:00:00.000Z' } })

const createSource = (
  harness: SocketHarness,
  logger: Logger = createLoggerSpy().logger,
  deadlineMs = 1000
): ReturnType<typeof createWebSocketDeviceSource> =>
  createWebSocketDeviceSource({
    url: 'ws://127.0.0.1:8080/api',
    deadlineMs,
    createSocket: (): SocketLike => harness.socket,
    logger,
  })

describe('createWebSocketDeviceSource', () => {
  afterEach((): void => {
    vi.useRealTimers()
  })

  it('resolves with the snapshot once the collector completes and closes the socket once', async () => {
    const harness = createSocketHarness()
    const source = createSource(harness)

    const pending = source.collect()
    harness.emitMessage(seedFrame())
    harness.emitMessage(reportFrame())

    await expect(pending).resolves.toEqual({
      ok: true,
      lastSeen: new Map([['lamp', Date.parse('2026-01-01T00:00:00.000Z')]]),
    })
    expect(harness.closeCalls()).toBe(1)
  })

  it('ignores events that arrive after settlement', async () => {
    const harness = createSocketHarness()
    const source = createSource(harness)

    const pending = source.collect()
    harness.emitMessage(seedFrame())
    harness.emitMessage(reportFrame())
    const result = await pending

    harness.emitError(new Error('late failure'))
    harness.emitClose()
    harness.emitMessage(reportFrame())

    await expect(pending).resolves.toBe(result)
    expect(harness.closeCalls()).toBe(1)
  })

  it('settles as a source error when the socket errors before completion', async () => {
    const harness = createSocketHarness()
    const source = createSource(harness)

    const pending = source.collect()
    harness.emitError(new Error('connection reset'))

    await expect(pending).resolves.toEqual({
      ok: false,
      reason: 'source-error',
      message: 'connection reset',
    })
    expect(harness.closeCalls()).toBe(1)
  })

  it('settles as a source error when the socket closes before completion', async () => {
    const harness = createSocketHarness()
    const source = createSource(harness)

    const pending = source.collect()
    harness.emitMessage(seedFrame())
    harness.emitClose()

    await expect(pending).resolves.toEqual({
      ok: false,
      reason: 'source-error',
      message: 'socket closed before completion',
    })
    expect(harness.closeCalls()).toBe(1)
  })

  it('settles with a timeout when the deadline expires', async () => {
    vi.useFakeTimers()
    const harness = createSocketHarness()
    const source = createSource(harness, createLoggerSpy().logger, 750)

    const pending = source.collect()
    harness.emitMessage(seedFrame())
    await vi.advanceTimersByTimeAsync(750)

    const result = await pending
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('timeout')
      expect(result.message).toContain('750')
    }
    expect(harness.closeCalls()).toBe(1)
  })

  it('does not fire the deadline once the scrape completed', async () => {
    vi.useFakeTimers()
    const harness = createSocketHarness()
    const source = createSource(harness, createLoggerSpy().logger, 750)

    const pending = source.collect()
    harness.emitMessage(seedFrame())
    harness.emitMessage(reportFrame())
    await vi.advanceTimersByTimeAsync(5000)

    const result = await pending
    expect(result.ok).toBe(true)
    expect(harness.closeCalls()).toBe(1)
  })

  it('logs and ignores a malformed frame without settling', async () => {
    const { logger, warn } = createLoggerSpy()
    const harness = createSocketHarness()
    const source = createSource(harness, logger)

    const pending = source.collect()
    harness.emitMessage('{not json')

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('malformed'))

    harness.emitMessage(seedFrame())
    harness.emitMessage(reportFrame())

    await expect(pending).resolves.toEqual({
      ok: true,
      lastSeen: new Map([['lamp', Date.parse('2026-01-01T00:00:00.000Z')]]),
    })
  })

  it('settles as a source error when the socket cannot be created', async () => {
    const { logger } = createLoggerSpy()
    const source = createWebSocketDeviceSource({
      url: 'ws://127.0.0.1:8080/api',
      deadlineMs: 1000,
      createSocket: (): SocketLike => {
        throw new Error('connect failed')
      },
      logger,
    })

    await expect(source.collect()).resolves.toEqual({
      ok: false,
      reason: 'source-error',
      message: 'connect failed',
    })
  })

  it('describes a non-Error rejection generically', async () => {
    const { logger } = createLoggerSpy()
    const source = createWebSocketDeviceSource({
      url: 'ws://127.0.0.1:8080/api',
      deadlineMs: 1000,
      createSocket: (): SocketLike => throwNonErrorObject(),
      logger,
    })

    await expect(source.collect()).resolves.toEqual({
      ok: false,
      reason: 'source-error',
      message: 'unknown error',
    })
  })
})
