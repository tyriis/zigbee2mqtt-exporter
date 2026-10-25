import { describe, expect, it } from 'vitest'
import { isExportableDevice, lastSeenSeconds, parseLastSeenMs } from '#root/domain/device'

describe('isExportableDevice', () => {
  it('accepts a named, typed device', () => {
    expect(isExportableDevice({ friendly_name: 'lamp', type: 'Router' })).toBe(true)
  })

  it('rejects the coordinator by type even when it has been renamed', () => {
    expect(isExportableDevice({ friendly_name: 'Coordinator', type: 'Coordinator' })).toBe(false)
    expect(isExportableDevice({ friendly_name: 'zigbee-hub', type: 'Coordinator' })).toBe(false)
  })

  it('rejects entries without a usable friendly_name', () => {
    expect(isExportableDevice({ type: 'EndDevice' })).toBe(false)
    expect(isExportableDevice({ friendly_name: '', type: 'EndDevice' })).toBe(false)
    expect(isExportableDevice({ friendly_name: 42, type: 'EndDevice' })).toBe(false)
  })
})

describe('parseLastSeenMs', () => {
  it('parses an ISO 8601 timestamp', () => {
    expect(parseLastSeenMs('2026-01-01T00:00:00.000Z')).toBe(Date.parse('2026-01-01T00:00:00.000Z'))
  })

  it('accepts an epoch millisecond number unchanged', () => {
    expect(parseLastSeenMs(1_767_225_600_000)).toBe(1_767_225_600_000)
  })

  it('returns undefined for values that cannot be parsed', () => {
    expect(parseLastSeenMs('not a timestamp')).toBeUndefined()
    expect(parseLastSeenMs('')).toBeUndefined()
    expect(parseLastSeenMs(undefined)).toBeUndefined()
    expect(parseLastSeenMs(null)).toBeUndefined()
    expect(parseLastSeenMs({})).toBeUndefined()
    expect(parseLastSeenMs(Number.NaN)).toBeUndefined()
    expect(parseLastSeenMs(Number.POSITIVE_INFINITY)).toBeUndefined()
  })
})

describe('lastSeenSeconds', () => {
  it('converts a difference in milliseconds to seconds', () => {
    expect(lastSeenSeconds(10_000, 12_500)).toBe(2.5)
  })

  it('keeps sub-second precision', () => {
    expect(lastSeenSeconds(1_000, 1_250)).toBe(0.25)
  })

  it('reports negative seconds under clock skew', () => {
    expect(lastSeenSeconds(2_000, 1_000)).toBe(-1)
  })

  it('returns NaN when the timestamp is unknown', () => {
    expect(lastSeenSeconds(undefined, 1_000)).toBe(Number.NaN)
  })
})
