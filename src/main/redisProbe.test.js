import { describe, it, expect, afterEach } from 'vitest'
import { createServer } from 'net'
import { check } from './redisProbe.js'

let server
let sockets = []

async function startListener(handler) {
  return new Promise((resolve) => {
    server = createServer((socket) => {
      sockets.push(socket)
      handler(socket)
    })
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

afterEach(async () => {
  // Probe timeouts leave half-open sockets — destroy them so server.close()
  // can resolve. server.closeAllConnections() would do this too but isn't
  // present on every Node we support; destroying manually is portable.
  for (const s of sockets) {
    try { s.destroy() } catch { /* already gone */ }
  }
  sockets = []
  if (server && server.listening) {
    await new Promise((resolve) => server.close(resolve))
  }
  server = null
})

describe('check', () => {
  it('resolves { ok: true } when the server replies with +PONG', async () => {
    const port = await startListener((socket) => {
      socket.once('data', () => socket.write('+PONG\r\n'))
    })
    expect(await check('127.0.0.1', port, 1000)).toEqual({ ok: true })
  })

  it('resolves { ok: true, authRequired: true } when Redis demands AUTH', async () => {
    const port = await startListener((socket) => {
      socket.once('data', () =>
        socket.write('-NOAUTH Authentication required.\r\n')
      )
    })
    const result = await check('127.0.0.1', port, 1000)
    expect(result.ok).toBe(true)
    expect(result.authRequired).toBe(true)
    expect(result.error).toMatch(/NOAUTH/)
  })

  it('resolves { ok: false } on a non-auth error reply', async () => {
    const port = await startListener((socket) => {
      socket.once('data', () => socket.write('-ERR something broke\r\n'))
    })
    const result = await check('127.0.0.1', port, 1000)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/ERR something broke/)
  })

  it('times out when the peer accepts the connection but never replies (WSL2 forwarding symptom)', async () => {
    const port = await startListener(() => {
      // Accept and hold — never write PONG. This is the case that SYN-only
      // probes falsely pass and StackExchange.Redis would then hang on.
    })
    const start = Date.now()
    const result = await check('127.0.0.1', port, 250)
    const elapsed = Date.now() - start
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/timed out/)
    expect(elapsed).toBeGreaterThanOrEqual(200)
    expect(elapsed).toBeLessThan(1500)
  })

  it('resolves { ok: false } when the peer closes before any reply', async () => {
    const port = await startListener((socket) => socket.end())
    const result = await check('127.0.0.1', port, 1000)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/closed before reply/)
  })

  it('resolves { ok: false } on a non-RESP protocol reply', async () => {
    const port = await startListener((socket) => {
      socket.once('data', () => socket.write('garbage junk\r\n'))
    })
    const result = await check('127.0.0.1', port, 1000)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/unexpected protocol reply/)
  })

  it('resolves { ok: false } when the port is closed', async () => {
    // Start and immediately close to obtain a definitely-unused port.
    const port = await startListener(() => {})
    await new Promise((resolve) => server.close(resolve))
    const result = await check('127.0.0.1', port, 500)
    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('times out on a routed-but-silent address (no SYN-ACK)', async () => {
    // 10.255.255.1 is reserved / typically black-holed. SYN never completes.
    const start = Date.now()
    const result = await check('10.255.255.1', 65500, 250)
    const elapsed = Date.now() - start
    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
    if (/timed out/.test(result.error)) {
      expect(elapsed).toBeGreaterThanOrEqual(200)
      expect(elapsed).toBeLessThan(1500)
    }
  })
})
