// Lightweight update *notification* — no electron-updater, no auto-download.
//
// Ask GitHub for the latest published release and report whether its tag is
// newer than the running version. The renderer surfaces that; nothing here
// downloads, installs, or restarts anything.
//
// LIFTED FROM CREIDHNE (src/main/updateCheck.js), deliberately near-verbatim.
// Two house apps grew an update check independently — creidhne's in JavaScript
// and corvath's in TypeScript — and both landed on the same scope: read a
// version, tell the user, no updater framework. HTOO-65's call is that when two
// adopters converge without coordinating, the shape is the house answer, and a
// third hand-rolled one gives eleven apps eleven notions of what "newer" means.
// Epona is JavaScript, so creidhne's is the copy that ports without a rewrite.
//
// Changed from creidhne: the repo URL, the User-Agent, and nothing else. Keep it
// that way — when the template adopts one of the two, Epona should be able to
// diff against it rather than reconcile with it.
//
// The check is best-effort by construction: every failure path returns a value
// instead of throwing, so an offline, rate-limited or release-less machine gets
// a quiet no rather than an error the user cannot act on.

const RELEASES_URL = 'https://api.github.com/repos/eriscorp/epona/releases/latest'
const TIMEOUT_MS = 10_000

function parseVersion(raw) {
  if (!raw) return null
  const cleaned = String(raw).trim().replace(/^v/i, '')
  const parts = cleaned
    .split('-')[0]
    .split('.')
    .map((p) => parseInt(p, 10))
  if (parts.length < 1 || parts.some((n) => Number.isNaN(n))) return null
  while (parts.length < 3) parts.push(0)
  return parts
}

function isNewer(latest, current) {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}

export async function checkForUpdates(currentVersion) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(RELEASES_URL, {
      headers: {
        'User-Agent': 'epona-update-check',
        Accept: 'application/vnd.github+json'
      },
      signal: controller.signal
    })
    // 404 is the answer for a repo with no published release yet, not a fault.
    if (res.status === 404) {
      return {
        ok: true,
        updateAvailable: false,
        currentVersion,
        latestVersion: null,
        reason: 'no-releases'
      }
    }
    if (!res.ok) {
      return { ok: false, error: `GitHub responded with ${res.status}` }
    }
    const data = await res.json()
    if (data.draft || data.prerelease) {
      return {
        ok: true,
        updateAvailable: false,
        currentVersion,
        latestVersion: null,
        reason: 'prerelease-only'
      }
    }
    const latestVersion = data.tag_name
    return {
      ok: true,
      updateAvailable: isNewer(latestVersion, currentVersion),
      currentVersion,
      latestVersion,
      releaseUrl: data.html_url,
      releaseName: data.name,
      releaseNotes: data.body
    }
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'timeout' : err.message || String(err) }
  } finally {
    clearTimeout(timer)
  }
}

export const __testing = { parseVersion, isNewer }
