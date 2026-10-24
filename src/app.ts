import Fastify, { type FastifyInstance } from 'fastify'
import type { DeviceSource } from '#root/application/device-source'
import { registerMetricsRoute } from '#root/http/metrics-route'

export interface AppDeps {
  source: DeviceSource
  now?: () => number
}

export const buildApp = (deps: AppDeps): FastifyInstance => {
  const app = Fastify({ logger: true })

  registerMetricsRoute(app, { source: deps.source, now: deps.now ?? Date.now })

  return app
}
