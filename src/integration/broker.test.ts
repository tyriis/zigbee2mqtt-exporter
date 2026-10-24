import { connect } from 'mqtt'
import { describe, expect, it } from 'vitest'
import { createLastSeenCollector } from '#root/application/last-seen-collector'

const BROKER_URL = 'mqtt://mqtt.techtales.io:1883'
const TOPIC = 'zigbee2mqtt/bridge/devices'
const PAYLOAD_TIMEOUT_MS = 10000

const enabled = process.env.RUN_LIVE_INTEGRATION === '1'

const readRetainedPayload = (): Promise<string | undefined> =>
  new Promise<string | undefined>((resolve): void => {
    const client = connect(BROKER_URL, { connectTimeout: PAYLOAD_TIMEOUT_MS })

    const finish = (payload: string | undefined): void => {
      clearTimeout(timer)
      client.end(true)
      resolve(payload)
    }

    const timer = setTimeout((): void => {
      finish(undefined)
    }, PAYLOAD_TIMEOUT_MS)

    client.on('error', (): void => {
      finish(undefined)
    })

    client.on('connect', (): void => {
      client.subscribe(TOPIC, { qos: 1 })
    })

    client.on('message', (_topic: string, message: Uint8Array): void => {
      finish(Buffer.from(message).toString('utf8'))
    })
  })

describe.skipIf(!enabled)('live zigbee2mqtt broker', (): void => {
  it('seeds non-coordinator devices from the retained bridge payload', async (ctx): Promise<void> => {
    const payload = await readRetainedPayload()

    if (payload === undefined) {
      ctx.skip()
      return
    }

    const devices = JSON.parse(payload) as unknown
    expect(Array.isArray(devices)).toBe(true)

    const collector = createLastSeenCollector()
    const seeded = collector.handle({ topic: TOPIC, payload: devices })

    // A non-empty, all-non-coordinator seed is still collecting until devices report.
    expect(seeded.status).toBe('collecting')

    const names = (devices as { friendly_name?: unknown; type?: unknown }[])
      .filter((entry) => entry.type !== 'Coordinator' && typeof entry.friendly_name === 'string')
      .map((entry) => entry.friendly_name as string)

    expect(names.length).toBeGreaterThan(0)

    const [firstDevice] = names
    const afterDevice = collector.handle({
      topic: firstDevice,
      payload: { last_seen: '2026-01-01T00:00:00.000Z' },
    })

    if (afterDevice.status === 'complete') {
      expect(afterDevice.lastSeen.has(firstDevice)).toBe(true)
      return
    }
    expect(names.length).toBeGreaterThan(1)
  })
})
