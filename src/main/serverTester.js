import { createConnection } from 'net'

// DA wire protocol: 0xAA 0x00 <length> <opcode> <data...>
const WELCOME_PREFIX = 0x1b
const WELCOME_TEXT = 'CONNECTED SERVER\n'

// Matches C# ServerTester: NetworkPacket(0xAA, 0x00, 0x0A, 0x62, 0x00, 0x34, 0x00, 0x0A, 0x88, 0x6E, 0x59, 0x59, 0x75)
const HANDSHAKE = Buffer.from([
  0xaa, 0x00, 0x0a, 0x62, 0x00, 0x34, 0x00, 0x0a, 0x88, 0x6e, 0x59, 0x59, 0x75
])

export function testConnection(hostname, port, versionCode) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      socket.destroy()
      resolve({ success: false, error: 'Connection timed out' })
    }, 3000)

    const socket = createConnection({ host: hostname, port }, () => {
      // Connected — wait for welcome packet
    })

    let step = 'welcome'

    socket.on('data', (data) => {
      // DA wire protocol: [0xAA] [size_hi] [size_lo] [command] [data...]
      // Header is 4 bytes, payload starts at offset 4
      if (step === 'welcome') {
        if (data.length < 5 || data[0] !== 0xaa) {
          cleanup()
          return resolve({ success: false, error: 'Unexpected welcome packet' })
        }
        // First payload byte (after 4-byte header) should be 0x1B ESC
        if (data[4] !== WELCOME_PREFIX) {
          cleanup()
          return resolve({ success: false, error: 'Unexpected welcome packet' })
        }
        // Send handshake
        socket.write(HANDSHAKE)

        // Send version packet
        const hi = (versionCode >> 8) & 0xff
        const lo = versionCode & 0xff
        socket.write(Buffer.from([0xaa, 0x00, 0x06, 0x00, hi, lo, 0x4c, 0x4b, 0x00]))
        step = 'response'
      } else if (step === 'response') {
        // Response is also wrapped: skip 4-byte header to get status
        const status = data.length >= 5 ? data[4] : data[0]
        cleanup()
        if (status === 0x01) {
          resolve({ success: false, error: 'Server rejected connection' })
        } else if (status === 0x02) {
          resolve({ success: false, error: 'Patch required' })
        } else {
          resolve({ success: true })
        }
      }
    })

    socket.on('error', (err) => {
      cleanup()
      resolve({ success: false, error: err.message })
    })

    function cleanup() {
      clearTimeout(timeout)
      socket.destroy()
    }
  })
}
