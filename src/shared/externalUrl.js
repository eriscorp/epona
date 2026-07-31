// Scheme allowlist for "open this in the user's browser". Pure string logic — no
// electron/node imports — so main can gate `shell.openExternal` on it and the unit
// tests can drive it directly.
//
// `shell.openExternal` hands the URL to the operating system, which will happily
// act on far more than a web link: `file:` opens a local path, `smb:` reaches a
// network share, and a registered custom scheme launches whatever claimed it. The
// only URLs Epona ever means to open are web pages (the GitHub intake repo,
// hybrasyl.com) and the occasional mailto, so allow exactly those and refuse the
// rest rather than trusting every caller to have checked.

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/** True when `url` is a well-formed URL whose scheme is safe to hand to the OS. */
export function isSafeExternalUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return false
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false // not a URL at all (relative path, bare string, control bytes)
  }
  return ALLOWED_PROTOCOLS.has(parsed.protocol)
}
