import { describe, it, expect } from 'vitest'
import { parseNetstatOwner, parseLsofOwner, parseSsOwner, stopByHandHint } from './portOwner.js'

// HTOO-596. Arch and a minimal Fedora install no lsof, and the adopted Stop then
// said "Stop it from Task Manager" on Linux.
describe('parseSsOwner', () => {
  it('finds the PID in an ss -Hltnp line', () => {
    const line =
      'LISTEN 0      512          0.0.0.0:2610       0.0.0.0:*    users:(("Hybrasyl",pid=5954,fd=200))'
    expect(parseSsOwner(line)).toBe(5954)
  })

  it('is null when ss names no process, or prints nothing', () => {
    expect(parseSsOwner('LISTEN 0 512 0.0.0.0:2610 0.0.0.0:*')).toBeNull()
    expect(parseSsOwner('')).toBeNull()
    expect(parseSsOwner(undefined)).toBeNull()
  })
})

describe('stopByHandHint', () => {
  it("names each OS's own tool", () => {
    expect(stopByHandHint('win32')).toBe('Stop it from Task Manager.')
    expect(stopByHandHint('darwin')).toMatch(/Activity Monitor/)
    expect(stopByHandHint('linux')).toMatch(/install lsof/)
    expect(stopByHandHint('linux')).not.toMatch(/Task Manager/)
  })
})

const NETSTAT = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1044
  TCP    0.0.0.0:2610           0.0.0.0:0              LISTENING       9876
  TCP    [::]:2610              [::]:0                 LISTENING       9876
  TCP    127.0.0.1:2611         0.0.0.0:0              LISTENING       5432
  TCP    127.0.0.1:52310        127.0.0.1:2610         ESTABLISHED     3120
`

describe('parseNetstatOwner', () => {
  it('finds the listener on the requested port', () => {
    expect(parseNetstatOwner(NETSTAT, 2610)).toBe(9876)
    expect(parseNetstatOwner(NETSTAT, 2611)).toBe(5432)
  })

  it('returns null when nothing listens on the port', () => {
    expect(parseNetstatOwner(NETSTAT, 2612)).toBe(null)
  })

  it("doesn't match a port that only appears as a foreign address", () => {
    // 127.0.0.1:52310 -> 127.0.0.1:2610 is an inbound connection, not a listener.
    // Its PID (3120) is a client of the server, so it must never be returned.
    expect(parseNetstatOwner(NETSTAT, 52310)).toBe(null)
  })

  it("doesn't match a port that is a suffix of a longer one", () => {
    // ':2610' must not match '127.0.0.1:52610'.
    const out = '  TCP    127.0.0.1:52610        0.0.0.0:0              LISTENING       777\n'
    expect(parseNetstatOwner(out, 2610)).toBe(null)
  })

  it('recognises a listener when the State column is localized', () => {
    // Non-English Windows translates "LISTENING"; the wildcard foreign address
    // still identifies the row.
    const german = '  TCP    0.0.0.0:2610           0.0.0.0:0              ABHÖREN         4242\n'
    expect(parseNetstatOwner(german, 2610)).toBe(4242)
  })

  it('ignores UDP rows', () => {
    const udp = '  UDP    0.0.0.0:2610           *:*                                    111\n'
    expect(parseNetstatOwner(udp, 2610)).toBe(null)
  })

  it('survives empty / garbage input', () => {
    expect(parseNetstatOwner('', 2610)).toBe(null)
    expect(parseNetstatOwner(undefined, 2610)).toBe(null)
    expect(parseNetstatOwner('nonsense\n\n', 2610)).toBe(null)
  })
})

describe('parseLsofOwner', () => {
  it('takes the first pid', () => {
    expect(parseLsofOwner('9876\n9877\n')).toBe(9876)
  })

  it('returns null for the no-match case (lsof prints nothing)', () => {
    expect(parseLsofOwner('')).toBe(null)
    expect(parseLsofOwner(undefined)).toBe(null)
    expect(parseLsofOwner('\n \n')).toBe(null)
  })
})
