import { promises as fs } from 'fs'
import { createLineBuffer } from './lineBuffer.js'

// Follow a file that another process appends to, line by line. On Windows a
// server runs in its own console window, and its console script copies each
// output line to a file in the instance's log folder; this reads that file
// into the Log Pane (HTOO-652).
//
// It polls rather than watches: fs.watch on Windows reports a change late or
// twice, and a read from the last offset is the same whatever it reports. A file
// that is not there yet is not an error; the next poll tries again. A file that
// gets shorter was started again, so the read starts from 0.
//
// @param {string} path
// @param {(line: string) => void} onLine
// @param {{ intervalMs?: number }} [options]
// @returns {{ stop: () => Promise<void> }} stop reads what is left, emits a last
//   line with no newline, and stops
export function tailFile(path, onLine, { intervalMs = 250 } = {}) {
  const lines = createLineBuffer(onLine)
  let offset = 0
  let reading = Promise.resolve()

  async function readNew() {
    let fh
    try {
      fh = await fs.open(path, 'r')
      const { size } = await fh.stat()
      if (size < offset) offset = 0
      while (offset < size) {
        const buf = Buffer.alloc(Math.min(64 * 1024, size - offset))
        const { bytesRead } = await fh.read(buf, 0, buf.length, offset)
        if (bytesRead === 0) break
        offset += bytesRead
        lines.push(buf.subarray(0, bytesRead))
      }
    } catch {
      /* not there yet, or gone: the next poll tries again */
    } finally {
      await fh?.close().catch(() => {})
    }
  }

  // One read at a time, in order.
  const poll = () => (reading = reading.then(readNew))
  const timer = setInterval(poll, intervalMs)
  poll()

  return {
    async stop() {
      clearInterval(timer)
      await poll()
      lines.flush()
    }
  }
}
