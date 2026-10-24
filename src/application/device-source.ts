import type { LastSeen } from '#root/domain/device'

export type CollectFailure = 'timeout' | 'source-error'

export type CollectResult =
  { ok: true; lastSeen: LastSeen } | { ok: false; reason: CollectFailure; message: string }

export interface DeviceSource {
  collect(): Promise<CollectResult>
}
