import type { Logger } from '#root/application/logger'
import { isExportableDevice, parseLastSeenMs, type LastSeen } from '#root/domain/device'

export interface Z2mMessage {
  topic: string
  payload: unknown
}

export type CollectorResult = { status: 'collecting' } | { status: 'complete'; lastSeen: LastSeen }

export interface LastSeenCollector {
  handle(message: Z2mMessage): CollectorResult
}

const DEVICES_TOPIC = 'bridge/devices'

const COLLECTING: CollectorResult = { status: 'collecting' }

const noop = (): void => {
  // intentionally empty: the default logger swallows warnings
}

const SILENT_LOGGER: Logger = { warn: noop, error: noop }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export const createLastSeenCollector = (logger: Logger = SILENT_LOGGER): LastSeenCollector => {
  const expected = new Set<string>()
  const reported = new Set<string>()
  const lastSeen = new Map<string, number>()
  const buffered: Z2mMessage[] = []
  let seeded = false
  let complete = false

  const completed = (): CollectorResult => ({ status: 'complete', lastSeen })

  const evaluate = (): CollectorResult => {
    if (expected.size === 0) {
      if (!seeded) {
        return COLLECTING
      }
      complete = true
      return completed()
    }
    if (Array.from(expected).every((name) => reported.has(name))) {
      complete = true
      return completed()
    }
    return COLLECTING
  }

  const record = (message: Z2mMessage): void => {
    if (!expected.has(message.topic)) {
      return
    }
    const payload = message.payload
    if (!isRecord(payload)) {
      return
    }
    reported.add(message.topic)
    const lastSeenMs = parseLastSeenMs(payload.last_seen)
    if (lastSeenMs === undefined) {
      logger.warn(
        `Device ${message.topic} reported without a usable last_seen timestamp, omitting its sample`,
        { device: message.topic }
      )
      return
    }
    lastSeen.set(message.topic, lastSeenMs)
  }

  const seed = (payload: unknown): void => {
    if (!Array.isArray(payload)) {
      return
    }
    seeded = true
    const next = new Set<string>()
    for (const entry of payload as unknown[]) {
      if (isRecord(entry) && isExportableDevice(entry)) {
        next.add(entry.friendly_name)
      }
    }
    for (const name of Array.from(expected)) {
      if (!next.has(name)) {
        expected.delete(name)
        reported.delete(name)
        lastSeen.delete(name)
      }
    }
    for (const name of next) {
      expected.add(name)
    }
    for (const message of buffered.splice(0)) {
      record(message)
    }
  }

  return {
    handle: (message: Z2mMessage): CollectorResult => {
      if (complete) {
        return completed()
      }
      if (message.topic === DEVICES_TOPIC) {
        seed(message.payload)
        return evaluate()
      }
      if (!seeded) {
        buffered.push(message)
        return COLLECTING
      }
      record(message)
      return evaluate()
    },
  }
}
