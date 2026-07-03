// Last path segment ("basename"), tolerant of mixed `\`/`/` separators and
// trailing slashes — users type world/asset dir paths by hand in both styles.
// Strips trailing separators, normalizes `\` to `/`, and returns the final
// non-empty segment (falling back to the cleaned string for a bare root).
// Dependency-free so both main and renderer can import it.
export function basenameOfPath(p) {
  const cleaned = p.replace(/[\\/]+$/, '').replace(/\\/g, '/')
  const segs = cleaned.split('/').filter(Boolean)
  return segs[segs.length - 1] || cleaned
}
