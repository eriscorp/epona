// Detects whether a filesystem path lives under a Windows "protected" location
// where launching the legacy Dark Ages client tends to fail with error 740
// (ERROR_ELEVATION_REQUIRED) — OneDrive-synced folders, Program Files, and the
// Windows directory. Shared by the main process (to explain a failed launch) and
// the renderer (to warn at client-selection time). Pure string matching — no fs
// or env access — so it imports cleanly into both electron-vite bundles.
//
// Returns a human-readable label for the location, or null when the path looks
// like a normal, user-writable folder.
export function detectProtectedLocation(p) {
  if (!p) return null
  const s = p.replace(/\\/g, '/').toLowerCase()
  // OneDrive personal ("/onedrive/") or business ("/onedrive - company/").
  if (/\/onedrive([ -][^/]*)?\//.test(s)) return 'OneDrive'
  if (/\/program files( \(x86\))?\//.test(s)) return 'Program Files'
  if (/^[a-z]:\/windows\//.test(s)) return 'the Windows folder'
  return null
}
