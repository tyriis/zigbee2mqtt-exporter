import { describe, expect, it } from 'vitest'
import { parseFrame } from '#root/infrastructure/message-parsing'

const frame = JSON.stringify({ topic: 'lamp', payload: { last_seen: '2026-01-01T00:00:00.000Z' } })

describe('parseFrame', () => {
  it('parses a Buffer frame', () => {
    expect(parseFrame(Buffer.from(frame))).toEqual({
      topic: 'lamp',
      payload: { last_seen: '2026-01-01T00:00:00.000Z' },
    })
  })

  it('parses a string frame', () => {
    expect(parseFrame(frame)).toEqual({
      topic: 'lamp',
      payload: { last_seen: '2026-01-01T00:00:00.000Z' },
    })
  })

  it('parses an ArrayBuffer frame', () => {
    const encoded = new TextEncoder().encode(frame)
    const buffer = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength)
    expect(parseFrame(buffer)).toEqual({
      topic: 'lamp',
      payload: { last_seen: '2026-01-01T00:00:00.000Z' },
    })
  })

  it('parses a frame split into a buffer array', () => {
    const half = Math.floor(frame.length / 2)
    expect(parseFrame([Buffer.from(frame.slice(0, half)), Buffer.from(frame.slice(half))])).toEqual(
      {
        topic: 'lamp',
        payload: { last_seen: '2026-01-01T00:00:00.000Z' },
      }
    )
  })

  it('parses a frame split into a string array', () => {
    expect(parseFrame([frame])).toEqual({
      topic: 'lamp',
      payload: { last_seen: '2026-01-01T00:00:00.000Z' },
    })
  })

  it('keeps an absent payload undefined', () => {
    expect(parseFrame('{"topic":"bridge/devices"}')).toEqual({
      topic: 'bridge/devices',
      payload: undefined,
    })
  })

  it('rejects a frame array holding an unsupported chunk', () => {
    expect(parseFrame([Buffer.from('{}'), 42])).toBeUndefined()
  })

  it('rejects malformed JSON', () => {
    expect(parseFrame('{not json')).toBeUndefined()
  })

  it('rejects non-object JSON values', () => {
    expect(parseFrame('"lamp"')).toBeUndefined()
    expect(parseFrame('null')).toBeUndefined()
    expect(parseFrame('42')).toBeUndefined()
  })

  it('rejects objects without a string topic', () => {
    expect(parseFrame('{"payload":{}}')).toBeUndefined()
    expect(parseFrame('{"topic":42,"payload":{}}')).toBeUndefined()
  })

  it('rejects unsupported frame types', () => {
    expect(parseFrame(42)).toBeUndefined()
    expect(parseFrame(undefined)).toBeUndefined()
  })
})
