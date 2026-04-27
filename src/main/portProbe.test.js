import { describe, it, expect } from 'vitest'
import { createServer } from 'net'
import { isPortInUse } from './portProbe.js'

function listenOnEphemeralPort() {
  return new Promise((resolve) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

describe('isPortInUse', () => {
  it('returns true when something is listening', async () => {
    const server = await listenOnEphemeralPort()
    const { port } = server.address()
    try {
      expect(await isPortInUse('127.0.0.1', port, 500)).toBe(true)
    } finally {
      await new Promise((r) => server.close(r))
    }
  })

  it('returns false when nothing is listening on the port', async () => {
    // Bind to grab a free port, then close so it's known-free for the probe.
    const server = await listenOnEphemeralPort()
    const { port } = server.address()
    await new Promise((r) => server.close(r))
    expect(await isPortInUse('127.0.0.1', port, 500)).toBe(false)
  })

  it('does not send any bytes to the listener', async () => {
    // Regression guard for the bug we just fixed: redisProbe.check sent a
    // RESP PING and treated unexpected replies as "free", producing false
    // negatives when the listener spoke a different protocol. A pure TCP
    // probe must not write to the socket.
    const server = createServer((conn) => {
      conn.on('data', () => {
        // If we ever receive data here, the probe wrote — fail the test.
        conn.write(Buffer.from('UNEXPECTED'))
      })
    })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const { port } = server.address()
    try {
      const result = await isPortInUse('127.0.0.1', port, 500)
      expect(result).toBe(true)
    } finally {
      await new Promise((r) => server.close(r))
    }
  })
})
