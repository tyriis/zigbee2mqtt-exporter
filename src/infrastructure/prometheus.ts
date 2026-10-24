import { lastSeenSeconds, type LastSeen } from '#root/domain/device'

const escapeLabelValue = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')

export const formatLastSeen = (lastSeen: LastSeen, now: number): string => {
  const lines = [
    '# HELP zigbee2mqtt_last_seen Device last seen in seconds',
    '# TYPE zigbee2mqtt_last_seen gauge',
  ]

  for (const [device, lastSeenMs] of lastSeen) {
    const seconds = lastSeenSeconds(lastSeenMs, now)
    lines.push(`zigbee2mqtt_last_seen{device="${escapeLabelValue(device)}"} ${seconds}`)
  }

  return `${lines.join('\n')}\n`
}
