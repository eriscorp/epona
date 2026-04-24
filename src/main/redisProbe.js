import { createConnection } from 'net'

// RESP-encoded `PING` command (RESP2 array of one bulk string).
const PING_FRAME = Buffer.from('*1\r\n$4\r\nPING\r\n')

// Probe a Redis endpoint by TCP-connecting and round-tripping a PING.
// A SYN-only check isn't enough on Windows — WSL2's localhost forwarding
// can ACK the connect and then drop the forwarded socket before any
// application bytes flow, which looks like "up" but causes StackExchange.Redis
// in the server to timeout mid-handshake. Here we also wait for a real reply:
//   +PONG\r\n                         → { ok: true }
//   -NOAUTH … \r\n / -WRONGPASS …    → { ok: true, authRequired: true, error }
//   any other error reply             → { ok: false, error }
//   connection closed before reply    → { ok: false, error: 'closed before reply' }
//   any non-'+'/-'-' byte             → { ok: false, error: 'unexpected protocol reply' }
//   deadline hit at any phase         → { ok: false, error: 'timed out …' }
//
// The deadline (default 1500ms) covers connect + read together so callers
// don't compose two budgets.
export function check(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let settled = false
    let buf = Buffer.alloc(0)

    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { socket.destroy() } catch { /* socket already gone */ }
      resolve(result)
    }

    const socket = createConnection({ host, port })

    const timer = setTimeout(() => {
      finish({ ok: false, error: `timed out after ${timeoutMs}ms` })
    }, timeoutMs)

    socket.once('connect', () => {
      socket.write(PING_FRAME)
    })

    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk])
      const eol = buf.indexOf('\r\n')
      if (eol < 0) return // wait for more bytes
      const line = buf.slice(0, eol).toString('utf-8')
      if (line.startsWith('+')) {
        // Anything +-prefixed counts as a live Redis: +PONG from an un-authed
        // server, +OK from a shared connection with an existing SELECT, etc.
        finish({ ok: true })
      } else if (line.startsWith('-')) {
        const msg = line.slice(1)
        if (/^(NOAUTH|WRONGPASS|ERR Client sent AUTH)/i.test(msg)) {
          finish({ ok: true, authRequired: true, error: msg })
        } else {
          finish({ ok: false, error: msg })
        }
      } else {
        finish({ ok: false, error: `unexpected protocol reply: ${JSON.stringify(line)}` })
      }
    })

    socket.once('end', () => {
      finish({ ok: false, error: 'connection closed before reply' })
    })
    socket.once('close', () => {
      finish({ ok: false, error: 'connection closed before reply' })
    })
    socket.once('error', (err) => {
      finish({ ok: false, error: err.message })
    })
  })
}
