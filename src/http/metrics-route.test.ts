import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { CollectResult, DeviceSource } from '#root/application/device-source'
import { buildApp } from '#root/app'

const CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8'

const createSource = (result: CollectResult): DeviceSource => ({
  collect: (): Promise<CollectResult> => Promise.resolve(result),
})

const HELP = '# HELP zigbee2mqtt_last_seen Device last seen in seconds'
const TYPE = '# TYPE zigbee2mqtt_last_seen gauge'

describe('GET /metrics', () => {
  let app: FastifyInstance | undefined

  afterEach(async (): Promise<void> => {
    if (app !== undefined) {
      await app.close()
      app = undefined
    }
  })

  it('renders the snapshot as Prometheus text', async () => {
    app = buildApp({
      source: createSource({ ok: true, lastSeen: new Map([['lamp', 10_000]]) }),
      now: (): number => 12_000,
    })

    const response = await app.inject({ method: 'GET', url: '/metrics' })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe(CONTENT_TYPE)
    expect(response.body).toBe(
      [HELP, TYPE, 'zigbee2mqtt_last_seen{device="lamp"} 2', ''].join('\n')
    )
  })

  it('defaults the clock to Date.now', async () => {
    app = buildApp({
      source: createSource({ ok: true, lastSeen: new Map([['lamp', Date.now()]]) }),
    })

    const response = await app.inject({ method: 'GET', url: '/metrics' })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe(CONTENT_TYPE)
    const lines = response.body.split('\n')
    expect(lines.slice(0, 2)).toEqual([HELP, TYPE])
    expect(lines[2]).toMatch(/^zigbee2mqtt_last_seen\{device="lamp"\} 0(\.\d+)?$/)
    expect(lines[3]).toBe('')
  })

  it('answers 500 when the source fails', async () => {
    app = buildApp({
      source: createSource({ ok: false, reason: 'source-error', message: 'connection reset' }),
      now: (): number => 1_000,
    })

    const response = await app.inject({ method: 'GET', url: '/metrics' })

    expect(response.statusCode).toBe(500)
    expect(response.headers['content-type']).toBe(CONTENT_TYPE)
    expect(response.body).toBe('Internal Server Error')
  })

  it('answers 504 when the scrape times out', async () => {
    app = buildApp({
      source: createSource({ ok: false, reason: 'timeout', message: 'no snapshot within 10000ms' }),
      now: (): number => 1_000,
    })

    const response = await app.inject({ method: 'GET', url: '/metrics' })

    expect(response.statusCode).toBe(504)
    expect(response.headers['content-type']).toBe(CONTENT_TYPE)
    expect(response.body).toBe('Gateway Timeout')
  })

  it('answers 200 with only the header lines when no device reported', async () => {
    app = buildApp({
      source: createSource({ ok: true, lastSeen: new Map() }),
      now: (): number => 0,
    })

    const response = await app.inject({ method: 'GET', url: '/metrics' })

    expect(response.statusCode).toBe(200)
    expect(response.body).toBe([HELP, TYPE, ''].join('\n'))
  })
})
