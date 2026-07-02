import { createConnection } from 'net'

// Shared TCP-probe scaffold: owns the connect/timeout/settled/destroy lifecycle
// so each probe (portProbe connect-check, redisProbe PING round-trip) supplies
// only its protocol logic. Resolves with whatever a handler passes to `finish`;
// the first `finish` wins and tears the socket down.
//
// handlers:
//   onConnect(socket, finish)  — called on 'connect' (write a request, or finish now)
//   onData(chunk, finish)      — called on each 'data' chunk (optional)
//   onError(err)  → value      — mapped to the resolve value on socket error
//   onEnd()       → value      — resolve value if the peer closes before finishing (optional)
//   onClose()     → value      — resolve value on 'close' before finishing (optional)
//   onTimeout()   → value      — resolve value when the deadline hits
export function withProbeSocket({ host, port, timeoutMs }, handlers) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        socket.destroy()
      } catch {
        /* already gone */
      }
      resolve(value)
    }
    const socket = createConnection({ host, port })
    const timer = setTimeout(() => finish(handlers.onTimeout()), timeoutMs)
    socket.once('connect', () => handlers.onConnect?.(socket, finish))
    if (handlers.onData) socket.on('data', (chunk) => handlers.onData(chunk, finish))
    socket.once('error', (err) => finish(handlers.onError(err)))
    if (handlers.onEnd) socket.once('end', () => finish(handlers.onEnd()))
    if (handlers.onClose) socket.once('close', () => finish(handlers.onClose()))
  })
}
