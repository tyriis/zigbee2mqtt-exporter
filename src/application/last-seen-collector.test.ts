import { describe, expect, it, vi } from 'vitest'
import type { Logger } from '#root/application/logger'
import { createLastSeenCollector } from '#root/application/last-seen-collector'

const LAMP = { friendly_name: 'lamp', type: 'Router' }
const PLUG = { friendly_name: 'plug', type: 'EndDevice' }
const SENSOR = { friendly_name: 'sensor', type: 'EndDevice' }
const COORDINATOR = { friendly_name: 'zigbee-hub', type: 'Coordinator' }

const T1 = '2026-01-01T00:00:00.000Z'
const T2 = '2026-01-01T00:00:01.000Z'
const T3 = '2026-01-01T00:00:02.000Z'

const createLoggerSpy = (): { logger: Logger; warn: ReturnType<typeof vi.fn<Logger['warn']>> } => {
  const warn = vi.fn<Logger['warn']>()
  return { logger: { warn, error: vi.fn<Logger['error']>() }, warn }
}

const seed = (...entries: unknown[]): { topic: string; payload: unknown } => ({
  topic: 'bridge/devices',
  payload: entries,
})

const report = (topic: string, lastSeen?: unknown): { topic: string; payload: unknown } => ({
  topic,
  payload: lastSeen === undefined ? {} : { last_seen: lastSeen },
})

describe('createLastSeenCollector', () => {
  it('completes once every seeded device has reported', () => {
    const collector = createLastSeenCollector()

    expect(collector.handle(seed(LAMP, PLUG, COORDINATOR))).toEqual({ status: 'collecting' })
    expect(collector.handle(report('lamp', T1))).toEqual({ status: 'collecting' })

    expect(collector.handle(report('plug', T2))).toEqual({
      status: 'complete',
      lastSeen: new Map([
        ['lamp', Date.parse(T1)],
        ['plug', Date.parse(T2)],
      ]),
    })
  })

  it('never expects a renamed coordinator', () => {
    const collector = createLastSeenCollector()

    expect(collector.handle(seed(COORDINATOR, LAMP))).toEqual({ status: 'collecting' })
    expect(collector.handle(report('lamp', T1))).toEqual({
      status: 'complete',
      lastSeen: new Map([['lamp', Date.parse(T1)]]),
    })
  })

  it('buffers device messages that arrive before the seed and replays them', () => {
    const collector = createLastSeenCollector()

    expect(collector.handle(report('lamp', T1))).toEqual({ status: 'collecting' })
    expect(collector.handle(report('plug', T2))).toEqual({ status: 'collecting' })
    expect(collector.handle(report('unknown-device', T3))).toEqual({ status: 'collecting' })

    expect(collector.handle(seed(LAMP, PLUG))).toEqual({
      status: 'complete',
      lastSeen: new Map([
        ['lamp', Date.parse(T1)],
        ['plug', Date.parse(T2)],
      ]),
    })
  })

  it('replays buffered messages in arrival order so the newest timestamp wins', () => {
    const collector = createLastSeenCollector()

    collector.handle(report('lamp', T1))
    collector.handle(report('lamp', T3))

    expect(collector.handle(seed(LAMP))).toEqual({
      status: 'complete',
      lastSeen: new Map([['lamp', Date.parse(T3)]]),
    })
  })

  it('keeps the newest timestamp across duplicate reports', () => {
    const collector = createLastSeenCollector()

    collector.handle(seed(LAMP, PLUG))
    expect(collector.handle(report('lamp', T1))).toEqual({ status: 'collecting' })
    expect(collector.handle(report('lamp', T2))).toEqual({ status: 'collecting' })

    expect(collector.handle(report('plug', T3))).toEqual({
      status: 'complete',
      lastSeen: new Map([
        ['lamp', Date.parse(T2)],
        ['plug', Date.parse(T3)],
      ]),
    })
  })

  it('reconciles a second seed: keeps timestamps, adds, drops and recomputes completion', () => {
    const collector = createLastSeenCollector()

    collector.handle(seed(LAMP, PLUG))
    collector.handle(report('lamp', T1))

    expect(collector.handle(seed(LAMP, SENSOR))).toEqual({ status: 'collecting' })
    expect(collector.handle(report('plug', T2))).toEqual({ status: 'collecting' })

    expect(collector.handle(report('sensor', T3))).toEqual({
      status: 'complete',
      lastSeen: new Map([
        ['lamp', Date.parse(T1)],
        ['sensor', Date.parse(T3)],
      ]),
    })
  })

  it('completes immediately for an empty seed and stays complete', () => {
    const collector = createLastSeenCollector()

    const empty = new Map<string, number>()
    expect(collector.handle(seed())).toEqual({ status: 'complete', lastSeen: empty })
    expect(collector.handle(report('lamp', T1))).toEqual({ status: 'complete', lastSeen: empty })
    expect(collector.handle(seed(LAMP))).toEqual({ status: 'complete', lastSeen: empty })
  })

  it('ignores a bridge/devices payload that is not an array', () => {
    const collector = createLastSeenCollector()

    expect(collector.handle({ topic: 'bridge/devices', payload: { devices: [] } })).toEqual({
      status: 'collecting',
    })
    expect(collector.handle(report('lamp', T1))).toEqual({ status: 'collecting' })

    // the buffered report is replayed as soon as a usable seed lands
    expect(collector.handle(seed(LAMP))).toEqual({
      status: 'complete',
      lastSeen: new Map([['lamp', Date.parse(T1)]]),
    })
  })

  it('keeps the current expected set when a later seed payload is not an array', () => {
    const collector = createLastSeenCollector()

    collector.handle(seed(LAMP))
    expect(collector.handle({ topic: 'bridge/devices', payload: null })).toEqual({
      status: 'collecting',
    })

    expect(collector.handle(report('lamp', T1))).toEqual({
      status: 'complete',
      lastSeen: new Map([['lamp', Date.parse(T1)]]),
    })
  })

  it('counts a device without a usable last_seen as reported but omits its sample', () => {
    const { logger, warn } = createLoggerSpy()
    const collector = createLastSeenCollector(logger)

    collector.handle(seed(LAMP, PLUG))
    collector.handle(report('lamp', T1))

    expect(collector.handle(report('plug'))).toEqual({
      status: 'complete',
      lastSeen: new Map([['lamp', Date.parse(T1)]]),
    })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('plug'), { device: 'plug' })
  })

  it('keeps a previously known timestamp when a later report has no last_seen', () => {
    const collector = createLastSeenCollector()

    collector.handle(seed(LAMP, PLUG))
    collector.handle(report('lamp', T1))
    expect(collector.handle(report('lamp'))).toEqual({ status: 'collecting' })

    expect(collector.handle(report('plug', T2))).toEqual({
      status: 'complete',
      lastSeen: new Map([
        ['lamp', Date.parse(T1)],
        ['plug', Date.parse(T2)],
      ]),
    })
  })

  it('treats an unparseable last_seen like a missing one', () => {
    const { logger, warn } = createLoggerSpy()
    const collector = createLastSeenCollector(logger)

    collector.handle(seed(LAMP))

    expect(collector.handle(report('lamp', 'yesterday'))).toEqual({
      status: 'complete',
      lastSeen: new Map(),
    })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('does not warn or throw with the default logger', () => {
    const collector = createLastSeenCollector()

    collector.handle(seed(LAMP))

    expect(collector.handle(report('lamp'))).toEqual({ status: 'complete', lastSeen: new Map() })
  })

  it('ignores unknown topics and non-object payloads', () => {
    const collector = createLastSeenCollector()

    collector.handle(seed(LAMP))
    expect(collector.handle(report('other-device', T1))).toEqual({ status: 'collecting' })
    expect(collector.handle({ topic: 'lamp', payload: 'not-an-object' })).toEqual({
      status: 'collecting',
    })

    expect(collector.handle(report('lamp', T1))).toEqual({
      status: 'complete',
      lastSeen: new Map([['lamp', Date.parse(T1)]]),
    })
  })

  it('skips malformed entries in the seed payload', () => {
    const collector = createLastSeenCollector()

    expect(collector.handle(seed(null, 'lamp', 42, { friendly_name: 7 }, LAMP, LAMP))).toEqual({
      status: 'collecting',
    })

    expect(collector.handle(report('lamp', T1))).toEqual({
      status: 'complete',
      lastSeen: new Map([['lamp', Date.parse(T1)]]),
    })
  })
})
