import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the DNS layer before importing the module under test — legacyTarget
// imports `lookup` at module scope. The native addon is left alone: it loads
// fine under plain node, and none of these cases reach it.
const lookup = vi.fn()
vi.mock('dns/promises', () => ({ lookup: (...args) => lookup(...args) }))

const { resolveIpv4, encodeHostnamePatch } = await import('./legacyTarget.js')

beforeEach(() => {
  lookup.mockReset()
})

describe('resolveIpv4', () => {
  it('forces family 4 so a dual-stack host cannot answer with IPv6', async () => {
    // HTOO-88. Without the family, `localhost` on a modern Windows box answers
    // ::1 first and the patch below silently encodes 0.0.0.0.
    lookup.mockResolvedValue({ address: '127.0.0.1', family: 4 })
    await expect(resolveIpv4('localhost')).resolves.toBe('127.0.0.1')
    expect(lookup).toHaveBeenCalledWith('localhost', { family: 4 })
  })

  it('propagates a resolution failure instead of returning a sentinel', async () => {
    lookup.mockRejectedValue(new Error('getaddrinfo ENOTFOUND nope.invalid'))
    await expect(resolveIpv4('nope.invalid')).rejects.toThrow(/ENOTFOUND/)
  })
})

describe('encodeHostnamePatch', () => {
  it('encodes each octet behind a push imm8, in reverse order', () => {
    expect([...encodeHostnamePatch('127.0.0.1')]).toEqual([0x6a, 1, 0x6a, 0, 0x6a, 0, 0x6a, 127])
  })

  it('encodes a full-range address without truncating an octet', () => {
    expect([...encodeHostnamePatch('192.168.255.10')]).toEqual([
      0x6a, 10, 0x6a, 255, 0x6a, 168, 0x6a, 192
    ])
  })

  it('rejects an IPv6 address rather than writing zeroes', () => {
    // The exact regression: '::1'.split('.') is one element, Number() gives NaN,
    // and Buffer.from turned every NaN into 0 — a client patched to 0.0.0.0
    // that starts, connects to nothing, and reports success.
    expect(() => encodeHostnamePatch('::1')).toThrow(/IPv4/)
    expect(() => encodeHostnamePatch('fe80::1ff:fe23:4567:890a')).toThrow(/IPv4/)
  })

  it('rejects a partial or over-long dotted quad', () => {
    expect(() => encodeHostnamePatch('127.0.0')).toThrow(/IPv4/)
    expect(() => encodeHostnamePatch('127.0.0.1.5')).toThrow(/IPv4/)
  })

  it('rejects an out-of-range or non-numeric octet', () => {
    expect(() => encodeHostnamePatch('127.0.0.256')).toThrow(/IPv4/)
    expect(() => encodeHostnamePatch('127.0.0.-1')).toThrow(/IPv4/)
    expect(() => encodeHostnamePatch('127.0.0.x')).toThrow(/IPv4/)
  })

  it('rejects the strings Number() would silently coerce to a valid octet', () => {
    // Each of these encodes without complaint if validation goes through
    // Number: '' reads as 0, '0x7f' as 127, ' 1 ' as 1. All three are a
    // different address than the user typed.
    expect(() => encodeHostnamePatch('127.0..1')).toThrow(/IPv4/)
    expect(() => encodeHostnamePatch('127.0.0.0x7f')).toThrow(/IPv4/)
    expect(() => encodeHostnamePatch('127.0.0. 1 ')).toThrow(/IPv4/)
  })

  it('names the address in the error so the profile field is findable', () => {
    expect(() => encodeHostnamePatch('::1')).toThrow(/"::1"/)
  })
})
