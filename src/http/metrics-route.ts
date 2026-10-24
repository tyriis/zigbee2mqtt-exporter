import type { FastifyInstance } from 'fastify'
import type { CollectFailure, DeviceSource } from '#root/application/device-source'
import { formatLastSeen } from '#root/infrastructure/prometheus'

export interface MetricsRouteDeps {
  source: DeviceSource
  now: () => number
}

const FAILURE_RESPONSES: Record<CollectFailure, { statusCode: number; body: string }> = {
  timeout: { statusCode: 504, body: 'Gateway Timeout' },
  'source-error': { statusCode: 500, body: 'Internal Server Error' },
}

const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8'

export const registerMetricsRoute = (app: FastifyInstance, deps: MetricsRouteDeps): void => {
  app.get('/metrics', async (_request, reply): Promise<void> => {
    const result = await deps.source.collect()

    if (!result.ok) {
      const failure = FAILURE_RESPONSES[result.reason]
      await reply.code(failure.statusCode).type(PROMETHEUS_CONTENT_TYPE).send(failure.body)
      return
    }

    await reply.type(PROMETHEUS_CONTENT_TYPE).send(formatLastSeen(result.lastSeen, deps.now()))
  })
}
