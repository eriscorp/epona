import { describe, it, expect, afterEach } from 'vitest'
import { createServer } from 'net'
import { testConnection } from './serverTester.js'

// Driven against a real loopback server rather than a mocked socket: the thing
// worth testing here is the wire exchange, and a mock of `net` would only
// assert that the code calls the functions it calls.

let server

afterEach(async () => {
  if (server) {
    await new Promise((r) => server.close(r))
    server = null
  }
})

// Start a server whose connection handler is supplied by the test. Resolves the
// ephemeral port it bound to.
function listen(onConnection) {
  return new Promise((resolve) => {
    server = createServer(onConnection)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

// A well-formed welcome: 0xAA, two size bytes, an opcode, then 0x1B as the
// first payload byte.
const welcome = (prefix = 0x1b) => Buffer.from([0xaa, 0x00, 0x02, 0x7e, prefix])

// A server that greets, then answers whatever it is sent with one status byte
// wrapped in the same 4-byte header. `seen` collects what the client wrote.
function greetThenAnswer(status, seen) {
  return (socket) => {
    socket.write(welcome())
    socket.once('data', (chunk) => {
      seen?.push(chunk)
      socket.write(Buffer.from([0xaa, 0x00, 0x02, 0x7e, status]))
    })
  }
}

describe('testConnection handshake', () => {
  it('succeeds when the server answers with a non-error status', async () => {
    const port = await listen(greetThenAnswer(0x00))
    await expect(testConnection('127.0.0.1', port, 0x0741)).resolves.toEqual({ success: true })
  })

  it('sends the fixed handshake and the version, high byte first', async () => {
    const seen = []
    const port = await listen(greetThenAnswer(0x00, seen))
    await testConnection('127.0.0.1', port, 0x0741)

    const sent = Buffer.concat(seen)
    // The handshake is byte-for-byte the C# ServerTester's packet.
    expect([...sent.subarray(0, 13)]).toEqual([
      0xaa, 0x00, 0x0a, 0x62, 0x00, 0x34, 0x00, 0x0a, 0x88, 0x6e, 0x59, 0x59, 0x75
    ])
    // 0x0741 splits to 0x07, 0x41 — big-endian, and getting it backwards is
    // the kind of mistake a live server answers with 'patch required'.
    expect([...sent.subarray(13)]).toEqual([0xaa, 0x00, 0x06, 0x00, 0x07, 0x41, 0x4c, 0x4b, 0x00])
  })
})

describe('testConnection failure reporting', () => {
  it('rejects a welcome that is not the DA magic byte', async () => {
    const port = await listen((s) => s.write(Buffer.from([0xff, 0x00, 0x02, 0x7e, 0x1b])))
    await expect(testConnection('127.0.0.1', port, 0x0741)).resolves.toEqual({
      success: false,
      error: 'Unexpected welcome packet'
    })
  })

  it('rejects a welcome shorter than a header plus one payload byte', async () => {
    const port = await listen((s) => s.write(Buffer.from([0xaa, 0x00, 0x02, 0x7e])))
    await expect(testConnection('127.0.0.1', port, 0x0741)).resolves.toEqual({
      success: false,
      error: 'Unexpected welcome packet'
    })
  })

  it('rejects a welcome whose first payload byte is not 0x1B', async () => {
    const port = await listen((s) => s.write(welcome(0x42)))
    await expect(testConnection('127.0.0.1', port, 0x0741)).resolves.toEqual({
      success: false,
      error: 'Unexpected welcome packet'
    })
  })

  it('reports a rejected connection (status 0x01)', async () => {
    const port = await listen(greetThenAnswer(0x01))
    await expect(testConnection('127.0.0.1', port, 0x0741)).resolves.toEqual({
      success: false,
      error: 'Server rejected connection'
    })
  })

  it('reports a required patch (status 0x02)', async () => {
    const port = await listen(greetThenAnswer(0x02))
    await expect(testConnection('127.0.0.1', port, 0x0741)).resolves.toEqual({
      success: false,
      error: 'Patch required'
    })
  })

  it('reads an unwrapped short response from byte 0', async () => {
    // The fallback branch: fewer than 5 bytes means there is no header to skip.
    const port = await listen((socket) => {
      socket.write(welcome())
      socket.once('data', () => socket.write(Buffer.from([0x02])))
    })
    await expect(testConnection('127.0.0.1', port, 0x0741)).resolves.toEqual({
      success: false,
      error: 'Patch required'
    })
  })

  it('surfaces a refused connection as the socket error', async () => {
    // Bind and immediately close, so the port is almost certainly free.
    const port = await listen(() => {})
    await new Promise((r) => server.close(r))
    server = null
    const result = await testConnection('127.0.0.1', port, 0x0741)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/ECONNREFUSED/)
  })
})
