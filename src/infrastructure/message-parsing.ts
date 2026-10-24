import type { Z2mMessage } from '#root/application/last-seen-collector'

const decodeFrame = (raw: unknown): string | undefined => {
  if (typeof raw === 'string') {
    return raw
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw).toString('utf8')
  }
  if (Buffer.isBuffer(raw)) {
    return raw.toString('utf8')
  }
  if (Array.isArray(raw)) {
    const parts: Buffer[] = []
    for (const part of raw as unknown[]) {
      if (typeof part === 'string') {
        parts.push(Buffer.from(part, 'utf8'))
      } else if (Buffer.isBuffer(part)) {
        parts.push(part)
      } else {
        return undefined
      }
    }
    return Buffer.concat(parts).toString('utf8')
  }
  return undefined
}

export const parseFrame = (raw: unknown): Z2mMessage | undefined => {
  const text = decodeFrame(raw)
  if (text === undefined) {
    return undefined
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return undefined
  }

  const { topic, payload } = parsed as { topic?: unknown; payload?: unknown }
  if (typeof topic !== 'string') {
    return undefined
  }

  return { topic, payload }
}
