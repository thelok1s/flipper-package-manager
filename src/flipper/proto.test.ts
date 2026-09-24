import { describe, expect, it } from 'vitest'
import { decodeAvailable, encodeMain } from './proto'

describe('decodeAvailable', () => {
  it('decodes whole frames and leaves partial ones for later', () => {
    const a = encodeMain(1, 'systemPingRequest', {})
    const b = encodeMain(2, 'storageReadRequest', { path: '/ext/apps/' + 'x'.repeat(300) + '.fap' })
    const stream = new Uint8Array([...a, ...b])
    // Cut inside the second frame, which has a two-byte length prefix.
    const cut = a.length + 10
    const first = decodeAvailable(stream.subarray(0, cut))
    expect(first.messages.map((m) => m.commandId)).toEqual([1])
    expect(first.consumed).toBe(a.length)
    const rest = decodeAvailable(stream.subarray(first.consumed))
    expect(rest.messages[0].storageReadRequest.path).toMatch(/x{300}\.fap$/)
    expect(rest.consumed).toBe(b.length)
    // A lone first byte of a length prefix is not enough to decode anything.
    expect(decodeAvailable(b.subarray(0, 1))).toEqual({ messages: [], consumed: 0 })
  })
})
