import { describe, expect, it } from 'vitest'
import { formatLastSeen } from '#root/infrastructure/prometheus'

const HELP = '# HELP zigbee2mqtt_last_seen Device last seen in seconds'
const TYPE = '# TYPE zigbee2mqtt_last_seen gauge'

describe('formatLastSeen', () => {
  it('renders the exact exposition body in insertion order with a trailing newline', () => {
    const lastSeen = new Map([
      ['lamp', 10_000],
      ['plug', 12_000],
    ])

    expect(formatLastSeen(lastSeen, 12_500)).toBe(
      [
        HELP,
        TYPE,
        'zigbee2mqtt_last_seen{device="lamp"} 2.5',
        'zigbee2mqtt_last_seen{device="plug"} 0.5',
        '',
      ].join('\n')
    )
  })

  it('renders only the header lines for an empty snapshot', () => {
    expect(formatLastSeen(new Map(), 12_500)).toBe([HELP, TYPE, ''].join('\n'))
  })

  it('escapes quotes, backslashes and newlines in label values', () => {
    const lastSeen = new Map([['weird"name\\path\nline', 10_000]])

    expect(formatLastSeen(lastSeen, 11_000)).toBe(
      [HELP, TYPE, 'zigbee2mqtt_last_seen{device="weird\\"name\\\\path\\nline"} 1', ''].join('\n')
    )
  })

  it('keeps sub-second precision and negative clock skew', () => {
    const lastSeen = new Map([
      ['fresh', 1_000],
      ['skewed', 2_000],
    ])

    expect(formatLastSeen(lastSeen, 1_250)).toBe(
      [
        HELP,
        TYPE,
        'zigbee2mqtt_last_seen{device="fresh"} 0.25',
        'zigbee2mqtt_last_seen{device="skewed"} -0.75',
        '',
      ].join('\n')
    )
  })
})
