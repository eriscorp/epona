import { describe, it, expect } from 'vitest'
import { createServer } from 'net'
import { withProbeSocket } from './probeSocket.js'

function listenOnEphemeralPort() {
  return new Promise((resolve) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

const HANDLERS = {
  onConnect: (_socket, finish) => finish('connected'),
  onError: () => 'error',
  onTimeout: () => 'timeout'
}

describe('withProbeSocket', () => {
  it('resolves via onConnect when something is listening', async () => {
    const server = await listenOnEphemeralPort()
    const { port } = server.address()
    try {
      const result = await withProbeSocket({ host: '127.0.0.1', port, timeoutMs: 500 }, HANDLERS)
      expect(result).toBe('connected')
    } finally {
      await new Promise((r) => server.close(r))
    }
  })

  it('resolves via onError when the port is refused', async () => {
    // Bind to grab a free port, then close so the connect is refused.
    const server = await listenOnEphemeralPort()
    const { port } = server.address()
    await new Promise((r) => server.close(r))
    const result = await withProbeSocket({ host: '127.0.0.1', port, timeoutMs: 500 }, HANDLERS)
    expect(result).toBe('error')
  })

  it('settles only once — the first finish wins', async () => {
    const server = await listenOnEphemeralPort()
    const { port } = server.address()
    try {
      const result = await withProbeSocket(
        { host: '127.0.0.1', port, timeoutMs: 500 },
        {
          onConnect: (_socket, finish) => {
            finish('first')
            finish('second')
          },
          onError: () => 'error',
          onTimeout: () => 'timeout'
        }
      )
      expect(result).toBe('first')
    } finally {
      await new Promise((r) => server.close(r))
    }
  })

  it('feeds data chunks to onData until it finishes', async () => {
    const server = createServer((conn) => conn.write(Buffer.from('PONG')))
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const { port } = server.address()
    try {
      const result = await withProbeSocket(
        { host: '127.0.0.1', port, timeoutMs: 500 },
        {
          onConnect: () => {},
          onData: (chunk, finish) => finish(chunk.toString()),
          onError: () => 'error',
          onTimeout: () => 'timeout'
        }
      )
      expect(result).toBe('PONG')
    } finally {
      await new Promise((r) => server.close(r))
    }
  })
})
