import { withProbeSocket } from './probeSocket.js'

// Pure TCP "is anything listening on this port?" check. Used for pre-launch
// port preflight where we don't know what protocol the existing listener
// might speak — sending bytes (e.g. RESP PING) gives false negatives when the
// listener is a Hybrasyl server or anything else non-Redis. Connect-only:
//   connect succeeds                → in use
//   ECONNREFUSED / any error        → free
//   timeout                         → treat as free (best-effort preflight,
//                                     not a security gate)
export function isPortInUse(host, port, timeoutMs = 500) {
  return withProbeSocket(
    { host, port, timeoutMs },
    {
      onConnect: (_socket, finish) => finish(true),
      onError: () => false,
      onTimeout: () => false
    }
  )
}
