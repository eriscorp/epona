import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

// The `portable:` block in electron-builder.yml, pinned because its decisions
// look wrong to a reader who has not read the comment above them, and nothing
// else in the repository exercises them.
//
// - `unpackDirName: true` (HTOO-351, fault 2). The electron-builder docs say
//   `false`, and `false` silently restores the build-time unpack folder that
//   shows the "Epona cannot be closed" box on a second launch.
//
// It lands on the PACKAGED exe only, so this checks the REQUEST and not the
// artifact.

const REPO_ROOT = join(import.meta.dirname, '..')
const YML = readFileSync(join(REPO_ROOT, 'electron-builder.yml'), 'utf8').replace(/\r\n/g, '\n')

/**
 * The keys of the top-level `portable:` block, comments excluded. The block ends
 * at the next column-0 key, so a key in another block cannot satisfy it.
 *
 * It takes the text so the same reader can be run over a block that HAS the key.
 * A test for an absence passes for the wrong reason as easily as the right one.
 */
function portableKeys(text = YML) {
  const lines = text.split('\n')
  const start = lines.indexOf('portable:')
  expect(start, 'the text has no top-level portable: block').toBeGreaterThan(-1)
  const keys = {}
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break
    const found = /^ {2}([A-Za-z]+):\s*(.*?)\s*$/.exec(line)
    if (found) keys[found[1]] = found[2]
  }
  return keys
}

describe('the portable target', () => {
  it('extracts to a folder unique to each launch (HTOO-351)', () => {
    // `true`, not the documented `false`: app-builder-lib gives `false` a
    // build-time KSUID, which is the collision this avoids.
    expect(portableKeys().unpackDirName).toBe('true')
  })

  it('reads the block it means to read', () => {
    // A reader that found nothing would pass an absence case vacuously.
    expect(portableKeys()).toHaveProperty('artifactName')
  })

  it('stops at the next block, so another block cannot satisfy it', () => {
    const elsewhere = ['portable:', '  artifactName: x', 'nsis:', '  unpackDirName: true'].join(
      '\n'
    )
    expect(portableKeys(elsewhere)).not.toHaveProperty('unpackDirName')
  })
})
