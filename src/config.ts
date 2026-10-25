export interface Config {
  port: number
  zigbee2mqttWsUrl: string
  scrapeDeadlineMs: number
}

const DEFAULT_PORT = 3000
const DEFAULT_WS_URL = 'ws://127.0.0.1:8080/api'
const DEFAULT_SCRAPE_DEADLINE_MS = 10000

const isUnset = (raw: string | undefined): boolean => raw === undefined || raw.trim() === ''

const readPort = (raw: string | undefined): number => {
  if (isUnset(raw)) {
    return DEFAULT_PORT
  }
  const port = Number(String(raw).trim())
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT "${String(raw)}": expected an integer between 1 and 65535`)
  }
  return port
}

const readWsUrl = (raw: string | undefined): string => {
  if (isUnset(raw)) {
    return DEFAULT_WS_URL
  }
  const value = String(raw).trim()
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`Invalid ZIGBEE2MQTT_WS "${value}": expected a ws:// or wss:// URL`)
  }
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error(`Invalid ZIGBEE2MQTT_WS "${value}": expected a ws:// or wss:// URL`)
  }
  return value
}

const readDeadlineMs = (raw: string | undefined): number => {
  if (isUnset(raw)) {
    return DEFAULT_SCRAPE_DEADLINE_MS
  }
  const deadlineMs = Number(String(raw).trim())
  if (!Number.isInteger(deadlineMs) || deadlineMs <= 0) {
    throw new Error(`Invalid SCRAPE_DEADLINE_MS "${String(raw)}": expected a positive integer`)
  }
  return deadlineMs
}

export const loadConfig = (env: NodeJS.ProcessEnv): Config => ({
  port: readPort(env.PORT),
  zigbee2mqttWsUrl: readWsUrl(env.ZIGBEE2MQTT_WS),
  scrapeDeadlineMs: readDeadlineMs(env.SCRAPE_DEADLINE_MS),
})
