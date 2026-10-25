export type LastSeen = ReadonlyMap<string, number>

export interface Z2mDeviceEntry {
  friendly_name?: unknown
  type?: unknown
}

export const isExportableDevice = (entry: Z2mDeviceEntry): entry is { friendly_name: string } =>
  typeof entry.friendly_name === 'string' &&
  entry.friendly_name !== '' &&
  entry.type !== 'Coordinator'

export const parseLastSeenMs = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }
  if (typeof value !== 'string' || value === '') {
    return undefined
  }
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

export const lastSeenSeconds = (lastSeenMs: number | undefined, now: number): number =>
  lastSeenMs === undefined ? Number.NaN : (now - lastSeenMs) / 1000
