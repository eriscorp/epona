import { StringDecoder } from 'string_decoder'

// Stream chunks (from child.stdout / stderr 'data' events) into complete lines.
// Chunks are not line-aligned, so we accumulate and emit onLine per '\n' boundary,
// stripping a trailing '\r' on CRLF inputs. flush() emits any remaining tail
// (e.g. a last line without a trailing newline when the child exits).
//
// A StringDecoder holds the bytes of a UTF-8 character that a chunk splits, and
// joins them to the next chunk. Decoding each chunk alone turned both halves
// into U+FFFD, so a non-ASCII path or name in the output came out as `��`
// (HTOO-653).
export function createLineBuffer(onLine) {
  let buf = ''
  const decoder = new StringDecoder('utf8')

  function push(chunk) {
    buf += decoder.write(chunk)
    let idx
    while ((idx = buf.indexOf('\n')) >= 0) {
      let line = buf.slice(0, idx)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      buf = buf.slice(idx + 1)
      onLine(line)
    }
  }

  function flush() {
    buf += decoder.end()
    if (buf.length === 0) return
    let line = buf
    if (line.endsWith('\r')) line = line.slice(0, -1)
    buf = ''
    onLine(line)
  }

  return { push, flush }
}
