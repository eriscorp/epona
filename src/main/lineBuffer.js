// Stream chunks (from child.stdout / stderr 'data' events) into complete lines.
// Chunks are not line-aligned, so we accumulate and emit onLine per '\n' boundary,
// stripping a trailing '\r' on CRLF inputs. flush() emits any remaining tail
// (e.g. a last line without a trailing newline when the child exits).
export function createLineBuffer(onLine) {
  let buf = ''

  function push(chunk) {
    buf += chunk.toString('utf-8')
    let idx
    while ((idx = buf.indexOf('\n')) >= 0) {
      let line = buf.slice(0, idx)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      buf = buf.slice(idx + 1)
      onLine(line)
    }
  }

  function flush() {
    if (buf.length === 0) return
    let line = buf
    if (line.endsWith('\r')) line = line.slice(0, -1)
    buf = ''
    onLine(line)
  }

  return { push, flush }
}
