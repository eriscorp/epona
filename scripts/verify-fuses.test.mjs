import { existsSync, readFileSync } from 'fs'
import { createRequire } from 'module'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

import {
  EXPECTED,
  FUSE_STATE,
  SENTINEL,
  checkWires,
  decodeFuseWires,
  fuseFilePath
} from './verify-fuses.mjs'

// The cheap half of HTOO-374, and it covers a different failure from the script
// it tests.
//
// `verify-fuses.mjs` only ever runs against a packaged artifact, which exists on
// a tag and nowhere else. This file runs on every commit and asserts that
// electron-builder.yml still asks for the fuses in the first place — so deleting
// or editing the block reds a PR instead of reaching a release. Match a check's
// frequency to what it can see: packaging on every PR to buy the artifact check
// would cost minutes for what this buys at a fraction of it.
//
// It also pins the copy of @electron/fuses' internal constants that the script
// carries. A copy of someone else's file rots silently, and the rot here is
// nastier than most: a moved sentinel makes the verifier find NOTHING rather
// than find something wrong.

const REPO_ROOT = join(import.meta.dirname, '..')
const require = createRequire(import.meta.url)

describe('electron-builder.yml electronFuses', () => {
  const yml = readFileSync(join(REPO_ROOT, 'electron-builder.yml'), 'utf8')

  it('asks for the six house fuses, with the house values', () => {
    // Read out of the file rather than parsed with a YAML library, because there
    // is no YAML dependency here and the block is flat. The anchor is the key at
    // column 0, so a `runAsNode` in a comment cannot satisfy it — and the block
    // ENDS at the next column-0 key, or the booleans in the `nsis` and `mac`
    // blocks below join the set and the assertion becomes about the wrong thing.
    const after = yml.split(/^electronFuses:$/m)[1]
    expect(after, 'electron-builder.yml has no electronFuses block').toBeDefined()
    const block = after.split(/^\S/m)[0]

    const settings = Object.fromEntries(
      Array.from(block.matchAll(/^ {2}([a-zA-Z]+): (true|false)$/gm), (m) => [
        m[1],
        m[2] === 'true'
      ])
    )
    expect(settings).toEqual({
      runAsNode: false,
      enableNodeCliInspectArguments: false,
      enableNodeOptionsEnvironmentVariable: false,
      onlyLoadAppFromAsar: true,
      enableEmbeddedAsarIntegrityValidation: true,
      resetAdHocDarwinSignature: true
    })
  })

  it('makes the reader assert every fuse the block sets, in the same state', () => {
    // The fuses are written in three places: the block, the map above and
    // EXPECTED. A fuse added to the first two and not to EXPECTED passes every
    // gate, and the release reader never reads it. This ties EXPECTED to the
    // block. A config key is the FuseV1Options name with a lowercase first letter.
    const block = yml.split(/^electronFuses:$/m)[1].split(/^\S/m)[0]
    const byName = (a, b) => a.name.localeCompare(b.name)
    const asked = Array.from(block.matchAll(/^ {2}([a-zA-Z]+): (true|false)$/gm))
      .filter(([, key]) => key !== 'resetAdHocDarwinSignature')
      .map(([, key, value]) => ({
        name: key[0].toUpperCase() + key.slice(1),
        state: value === 'true' ? FUSE_STATE.ENABLE : FUSE_STATE.DISABLE
      }))
    const read = EXPECTED.map(({ name, state }) => ({ name, state }))
    expect(read.sort(byName)).toEqual(asked.sort(byName))
  })

  it('is the only place resetAdHocDarwinSignature can be checked', () => {
    // It is NOT a fuse: absent from FuseV1Options, never written to the wire. It
    // tells electron-builder to re-sign after flipping, which leaves no trace in
    // the artifact. So the config assertion above is the whole of its coverage.
    // This pins that reasoning to the package.
    const config = require('@electron/fuses')
    expect(Object.keys(config.FuseV1Options)).not.toContain('resetAdHocDarwinSignature')
  })

  it('flips the fuses through electron-builder, not in the afterPack hook', () => {
    // A per-arch hook corrupts a universal mac merge with an "identical SHAs"
    // failure; only electron-builder can sequence it, and the comment above the
    // block says so. Epona has one afterPack hook, and it signs da_win32.node.
    // It must stay that hook alone, return at once off Windows, and never touch
    // the fuses. Anchored at column 0, so a comment that names afterPack cannot
    // satisfy or break this.
    expect(yml.match(/^afterPack: (.+)$/gm)).toEqual(['afterPack: scripts/after-pack-sign.js'])
    const hook = readFileSync(join(REPO_ROOT, 'scripts', 'after-pack-sign.js'), 'utf8')
    expect(hook).toContain("if (context.electronPlatformName !== 'win32') return")
    expect(hook).not.toMatch(/fuse/i)
  })
})

describe('the copied @electron/fuses constants', () => {
  // A deep import into `dist/`. The package publishes no `exports` map, so this
  // resolves — and if a future version adds one, this line fails and names the
  // thing to re-check, which is the point.
  const upstream = require('@electron/fuses/dist/constants.js')
  const config = require('@electron/fuses')

  it('still matches the sentinel the package writes', () => {
    expect(SENTINEL).toBe(upstream.SENTINEL)
  })

  it('still matches the state bytes the package writes', () => {
    expect(FUSE_STATE.DISABLE).toBe(upstream.FuseState.DISABLE)
    expect(FUSE_STATE.ENABLE).toBe(upstream.FuseState.ENABLE)
    expect(FUSE_STATE.REMOVED).toBe(upstream.FuseState.REMOVED)
    expect(FUSE_STATE.INHERIT).toBe(upstream.FuseState.INHERIT)
  })

  it('names each asserted fuse at the position the package gives it', () => {
    // The wire is unlabelled bytes, so a position that drifts would silently
    // assert the wrong fuse — reading, say, EnableCookieEncryption and calling it
    // RunAsNode. This is the only thing that ties our indices to upstream's.
    for (const fuse of EXPECTED) {
      expect(config.FuseV1Options[fuse.index]).toBe(fuse.name)
    }
  })
})

// A packaged artifact is ~200 MB and does not exist on a machine that has not
// run electron-builder, so the decoder is driven with buffers built here. The
// unit tests prove the logic; the release job proves what shipped.
function wire(states, { version = 1, prefix = 'padding', suffix = 'tail' } = {}) {
  return Buffer.concat([
    Buffer.from(prefix),
    Buffer.from(SENTINEL),
    Buffer.from([version, states.length]),
    Buffer.from(states),
    Buffer.from(suffix)
  ])
}

// A wire as electron-builder leaves it: eight fuses, the five Epona sets in
// their configured states, the rest inherited.
const GOOD = [
  FUSE_STATE.DISABLE, // 0 RunAsNode
  FUSE_STATE.INHERIT, // 1 EnableCookieEncryption
  FUSE_STATE.DISABLE, // 2 EnableNodeOptionsEnvironmentVariable
  FUSE_STATE.DISABLE, // 3 EnableNodeCliInspectArguments
  FUSE_STATE.ENABLE, //  4 EnableEmbeddedAsarIntegrityValidation (HTOO-381)
  FUSE_STATE.ENABLE, //  5 OnlyLoadAppFromAsar
  FUSE_STATE.INHERIT, // 6 LoadBrowserProcessSpecificV8Snapshot
  FUSE_STATE.INHERIT //  7 GrantFileProtocolExtraPrivileges
]

describe('decodeFuseWires', () => {
  it('reads version, length and states at the sentinel', () => {
    expect(decodeFuseWires(wire(GOOD))).toEqual([
      { offset: 'padding'.length, version: 1, states: GOOD }
    ])
  })

  it('finds EVERY sentinel, not only the first', () => {
    // The reason this does not call `getCurrentFuseWire`. A universal mac
    // artifact carries one wire per slice, and the package's public reader
    // returns the first while `flipFuses` writes both — it would pass an artifact
    // whose second half was never flipped.
    const universal = Buffer.concat([wire(GOOD), wire(GOOD)])
    expect(decodeFuseWires(universal)).toHaveLength(2)
  })

  it('reads only as many states as the wire declares', () => {
    // A shorter wire is an older Electron, not a corrupt one. The bytes after it
    // are the binary, and reading them as fuses would invent states.
    const short = decodeFuseWires(wire(GOOD.slice(0, 6)))
    expect(short[0].states).toHaveLength(6)
  })
})

describe('checkWires', () => {
  it('passes a correctly flipped wire', () => {
    expect(checkWires(decodeFuseWires(wire(GOOD)))).toEqual([])
  })

  it('fails an artifact with no wire at all', () => {
    // The self-check, and the case a naive implementation reports as a pass: a
    // moved sentinel, a truncated read or a path pointing at the wrong file all
    // arrive here as zero wires. Nothing checked must never read as nothing
    // wrong.
    expect(checkWires([])).toEqual([
      'no fuse wire found — not an Electron binary, or the sentinel has moved'
    ])
  })

  it('fails every fuse when the block is dropped from the config', () => {
    // The regression this whole file exists for. With no `electronFuses`, the
    // binary ships Electron's defaults — RunAsNode, NodeOptions and
    // NodeCliInspect enabled, EmbeddedAsarIntegrityValidation and
    // OnlyLoadAppFromAsar disabled — and all five are named, rather than the
    // first one found.
    const defaults = [...GOOD]
    defaults[0] = FUSE_STATE.ENABLE
    defaults[2] = FUSE_STATE.ENABLE
    defaults[3] = FUSE_STATE.ENABLE
    defaults[4] = FUSE_STATE.DISABLE
    defaults[5] = FUSE_STATE.DISABLE

    const problems = checkWires(decodeFuseWires(wire(defaults)))
    expect(problems).toHaveLength(5)
    expect(problems.join('\n')).toContain(
      'EnableEmbeddedAsarIntegrityValidation is DISABLE, expected ENABLE'
    )
    expect(problems.join('\n')).toContain('RunAsNode is ENABLE, expected DISABLE')
    expect(problems.join('\n')).toContain('OnlyLoadAppFromAsar is DISABLE, expected ENABLE')
  })

  it('names the slice when more than one wire is present', () => {
    // A universal binary whose second slice was missed has to say WHICH slice, or
    // the report reads as a config error rather than a merge one.
    const bad = [...GOOD]
    bad[0] = FUSE_STATE.ENABLE
    const problems = checkWires(decodeFuseWires(Buffer.concat([wire(GOOD), wire(bad)])))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/RunAsNode is ENABLE.*slice at offset \d+/)
  })

  it('rejects a wire version it does not understand', () => {
    // V2 would renumber the positions. Reading it with V1 indices would assert
    // the wrong fuses and report a confident pass.
    const problems = checkWires(decodeFuseWires(wire(GOOD, { version: 2 })))
    expect(problems).toEqual(['fuse wire version 2, expected 1'])
  })

  it('reports a fuse that falls off the end of a short wire', () => {
    // An Electron too old to carry the last two asserted fuses. `undefined` would
    // otherwise stringify into a message nobody can act on.
    const problems = checkWires(decodeFuseWires(wire(GOOD.slice(0, 4))))
    expect(problems).toEqual([
      'EnableEmbeddedAsarIntegrityValidation is off the end of the wire, expected ENABLE',
      'OnlyLoadAppFromAsar is off the end of the wire, expected ENABLE'
    ])
  })
})

describe('fuseFilePath', () => {
  it('leaves a plain binary alone', () => {
    expect(fuseFilePath('dist/win-unpacked/Epona.exe')).toBe('dist/win-unpacked/Epona.exe')
  })

  it('resolves a .app bundle to the framework binary that holds the wire', () => {
    // electron-builder hands @electron/fuses the .app path, so this has to read
    // the same file that wrote.
    expect(fuseFilePath('dist/mac-universal/Epona.app')).toContain(
      join('Electron Framework.framework', 'Electron Framework')
    )
  })
})

// The card's "done when" asks for a check against a BUILT artifact that skips
// rather than fails when there is no build. That is this: it runs for whoever
// has just packaged one (and in the release job), and is inert everywhere else.
//
// Skipping is the honest outcome rather than a weakness — the alternative is a
// suite that cannot pass on a clean checkout. What must not happen is a skip
// that reads as a pass, so the skip says what it did not check.
describe('the packaged artifact, when one exists', () => {
  const CANDIDATES = [
    join(REPO_ROOT, 'dist', 'win-unpacked', 'Epona.exe'),
    join(REPO_ROOT, 'dist', 'linux-unpacked', 'epona'),
    join(REPO_ROOT, 'dist', 'mac-universal', 'Epona.app'),
    join(REPO_ROOT, 'dist', 'mac', 'Epona.app')
  ]
  const target = CANDIDATES.find((p) => existsSync(fuseFilePath(p)))

  it.skipIf(!target)('has every fuse applied', () => {
    const problems = checkWires(decodeFuseWires(readFileSync(fuseFilePath(target))))
    expect(problems, `Electron fuses are wrong on ${target}`).toEqual([])
  })

  it.skipIf(target)('reports that there was no build to inspect', () => {
    // Makes the skip visible in the run rather than silent. `npm run build:unpack`
    // produces the artifact the test above wants.
    expect(target).toBeUndefined()
  })
})
