import { describe, expect, it } from 'vitest'
import { loadConfig } from '#root/config'

describe('loadConfig', () => {
  it('applies defaults for a missing environment', () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      zigbee2mqttWsUrl: 'ws://127.0.0.1:8080/api',
      scrapeDeadlineMs: 10000,
    })
  })

  it('applies defaults for empty values', () => {
    expect(loadConfig({ PORT: '', ZIGBEE2MQTT_WS: '  ', SCRAPE_DEADLINE_MS: '' })).toEqual({
      port: 3000,
      zigbee2mqttWsUrl: 'ws://127.0.0.1:8080/api',
      scrapeDeadlineMs: 10000,
    })
  })

  it('reads overrides', () => {
    expect(
      loadConfig({
        PORT: '8080',
        ZIGBEE2MQTT_WS: 'wss://zigbee.example.com/api',
        SCRAPE_DEADLINE_MS: '2500',
      })
    ).toEqual({
      port: 8080,
      zigbee2mqttWsUrl: 'wss://zigbee.example.com/api',
      scrapeDeadlineMs: 2500,
    })
  })

  it('rejects a non-numeric PORT', () => {
    expect(() => loadConfig({ PORT: 'http' })).toThrow(/PORT/)
  })

  it('rejects PORT 0', () => {
    expect(() => loadConfig({ PORT: '0' })).toThrow(/PORT/)
  })

  it('rejects PORT above 65535', () => {
    expect(() => loadConfig({ PORT: '70000' })).toThrow(/PORT/)
  })

  it('rejects a ZIGBEE2MQTT_WS that is not a URL', () => {
    expect(() => loadConfig({ ZIGBEE2MQTT_WS: 'not a url' })).toThrow(/ZIGBEE2MQTT_WS/)
  })

  it('rejects a ZIGBEE2MQTT_WS with the wrong protocol', () => {
    expect(() => loadConfig({ ZIGBEE2MQTT_WS: 'http://127.0.0.1:8080/api' })).toThrow(
      /ZIGBEE2MQTT_WS/
    )
  })

  it('rejects a non-numeric SCRAPE_DEADLINE_MS', () => {
    expect(() => loadConfig({ SCRAPE_DEADLINE_MS: 'soon' })).toThrow(/SCRAPE_DEADLINE_MS/)
  })

  it('rejects a non-positive SCRAPE_DEADLINE_MS', () => {
    expect(() => loadConfig({ SCRAPE_DEADLINE_MS: '0' })).toThrow(/SCRAPE_DEADLINE_MS/)
  })
})
