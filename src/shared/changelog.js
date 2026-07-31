// Pure parsing for the Settings > About > What's New viewer. No electron/node
// imports — main reads the file, this turns the text into something renderable,
// and the unit tests drive it directly.
//
// The input is Epona's own CHANGELOG.md (Keep a Changelog 1.1.0): `## [X.Y.Z] - date`
// release headings, `### Added|Changed|Fixed|…` groups beneath them, and `- ` bullets
// with a bolded lead sentence. This is a deliberately partial markdown reader — it
// handles exactly the shapes that file uses, which is why it costs no dependency.
// `scripts/changelog-extract.mjs` reads the same file for the release workflow; that
// one only needs a single section's raw text, so the two stay separate.

/**
 * Split a changelog into release sections, newest first (file order).
 *
 * Returns `[{ version, date, groups: [{ heading, items }] }]`, where `items` are the
 * bullet strings with their `- ` marker and hard-wrap folded away. Sections with no
 * content are dropped — that is how the empty `## [Unreleased]` of a shipped build
 * stays out of the dialog without needing a special case for its name.
 */
export function parseChangelog(text) {
  if (typeof text !== 'string' || text.length === 0) return []
  const lines = text.split(/\r?\n/)

  const sections = []
  let current = null
  let group = null
  let bullet = null

  // A bullet can span several lines (the file hard-wraps prose). Fold continuation
  // lines into the bullet they belong to; a blank line ends the bullet.
  const flushBullet = () => {
    if (bullet && group) group.items.push(bullet.join(' ').replace(/\s+/g, ' ').trim())
    bullet = null
  }
  const flushGroup = () => {
    flushBullet()
    if (group && group.items.length > 0) current.groups.push(group)
    group = null
  }
  const flushSection = () => {
    flushGroup()
    if (current && current.groups.length > 0) sections.push(current)
    current = null
  }

  for (const line of lines) {
    const release = /^##\s+\[([^\]]+)\]\s*(?:-\s*(.*))?$/.exec(line)
    if (release) {
      flushSection()
      current = { version: release[1].trim(), date: (release[2] ?? '').trim(), groups: [] }
      continue
    }
    if (!current) continue // preamble / HTML comment above the first release

    const heading = /^###\s+(.*)$/.exec(line)
    if (heading) {
      flushGroup()
      group = { heading: heading[1].trim(), items: [] }
      continue
    }

    const item = /^[-*]\s+(.*)$/.exec(line)
    if (item) {
      flushBullet()
      // A bullet before any `###` (some sections list changes flat) still belongs
      // somewhere — give it an unlabelled group.
      if (!group) group = { heading: '', items: [] }
      bullet = [item[1]]
      continue
    }

    if (line.trim() === '') {
      flushBullet()
      continue
    }
    if (bullet) bullet.push(line.trim())
  }
  flushSection()

  return sections
}

/**
 * Split one bullet's text into inline runs for rendering: `**bold**` and `` `code` ``.
 *
 * Returns `[{ type: 'text' | 'strong' | 'code', value }]`. Unmatched markers are left
 * as literal text rather than swallowed — a stray asterisk in a changelog entry should
 * render as an asterisk, not eat the rest of the line.
 */
export function parseInline(text) {
  if (typeof text !== 'string' || text.length === 0) return []
  const runs = []
  // Code first: a backtick span is literal, so `**` inside it is not emphasis.
  const pattern = /`([^`]+)`|\*\*([^*]+(?:\*(?!\*)[^*]*)*)\*\*/g
  let last = 0
  let m
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) runs.push({ type: 'text', value: text.slice(last, m.index) })
    if (m[1] !== undefined) runs.push({ type: 'code', value: m[1] })
    else runs.push({ type: 'strong', value: m[2] })
    last = m.index + m[0].length
  }
  if (last < text.length) runs.push({ type: 'text', value: text.slice(last) })
  return runs
}
