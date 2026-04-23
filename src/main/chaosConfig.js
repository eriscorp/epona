import { promises as fs } from 'fs'
import { join } from 'path'

const CFG_FILENAME = 'Darkages.cfg'

// Parse cfg lines using the same rules as the sibling Hybrasyl client's
// DarkagesCfg parser: split on first ':', trim both sides, case-insensitive
// keys (stored lowercased here), last-write-wins, skip blank/colonless/empty-key
// lines.
export function parseLines(lines) {
  const result = {}
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '')
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon).trim()
    if (key.length === 0) continue
    const value = line.slice(colon + 1).trim()
    result[key.toLowerCase()] = value
  }
  return result
}

function detectEol(text) {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

// Merge `patches` into `existing` cfg text, preserving every unknown line verbatim.
// For each patched key: replace the first case-insensitive match in-place and drop any
// subsequent duplicates; if the key wasn't present, append it at the end.
// Line endings are preserved: if the original used CRLF, so does the output.
// Patch keys are written with their canonical casing as supplied.
export function mergeCfg(existing, patches) {
  const eol = detectEol(existing)
  const hasTrailingNewline = existing.length > 0 && /\r?\n$/.test(existing)
  const rawLines = existing.length === 0 ? [] : existing.split(/\r?\n/)
  // split on /\r?\n/ leaves a trailing empty string when text ends with a newline; drop it
  if (hasTrailingNewline && rawLines[rawLines.length - 1] === '') rawLines.pop()

  const patchKeysLower = Object.keys(patches).map((k) => k.toLowerCase())
  const applied = new Set()

  const outLines = []
  for (const line of rawLines) {
    const colon = line.indexOf(':')
    if (colon < 0) {
      outLines.push(line)
      continue
    }
    const key = line.slice(0, colon).trim().toLowerCase()
    const patchIndex = patchKeysLower.indexOf(key)
    if (patchIndex < 0) {
      outLines.push(line)
      continue
    }
    const canonicalKey = Object.keys(patches)[patchIndex]
    if (!applied.has(key)) {
      outLines.push(`${canonicalKey}: ${patches[canonicalKey]}`)
      applied.add(key)
    }
    // else: duplicate, drop
  }

  for (const canonicalKey of Object.keys(patches)) {
    if (!applied.has(canonicalKey.toLowerCase())) {
      outLines.push(`${canonicalKey}: ${patches[canonicalKey]}`)
    }
  }

  const joined = outLines.join(eol)
  if (outLines.length === 0) return ''
  return hasTrailingNewline || existing.length === 0 ? joined + eol : joined
}

export async function readCfg(dataPath) {
  const path = join(dataPath, CFG_FILENAME)
  try {
    const raw = await fs.readFile(path, 'utf-8')
    return parseLines(raw.split(/\r?\n/))
  } catch (err) {
    if (err.code === 'ENOENT') return {}
    throw err
  }
}

export async function writeCfg(dataPath, patches) {
  const path = join(dataPath, CFG_FILENAME)
  let existing = ''
  try {
    existing = await fs.readFile(path, 'utf-8')
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
  const merged = mergeCfg(existing, patches)
  await fs.writeFile(path, merged, 'utf-8')
}
