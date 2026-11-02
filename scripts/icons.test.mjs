import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'

// build/icons/ and build/icon.icns are GENERATED but COMMITTED — CI has no
// ImageMagick, so electron-builder reads whatever is in the tree. That makes
// them exactly the kind of thing that goes stale silently: change
// build/icon-square.png, forget `node scripts/make-icons.mjs`, and the build
// stays green while the package ships the previous artwork.
//
// This reads PNG headers directly rather than shelling out, so it needs no
// ImageMagick and runs in the ordinary suite. It therefore checks the two
// properties a header carries — geometry and colour type — and NOT the alpha
// bounding box, which needs pixel decoding. make-icons.mjs asserts the bounding
// boxes itself, at the moment it writes them, which is where the check that
// needs a decoder belongs.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUILD = join(REPO_ROOT, 'build')

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512]
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
// PNG colour type 6 is truecolour WITH alpha. Type 2 is truecolour without, and
// that is the failure this catches: a master flattened onto its background
// renders everything around the star as a solid rectangle at every size.
const RGBA = 6

function readHeader(path) {
  const buf = readFileSync(path)
  expect(buf.subarray(0, 8), `${path} is not a PNG`).toEqual(PNG_SIGNATURE)
  expect(buf.subarray(12, 16).toString('ascii'), `${path} first chunk`).toBe('IHDR')
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    colorType: buf.readUInt8(25)
  }
}

describe('committed icon artifacts', () => {
  it('build/icon-square.png is the 1024 RGBA master', () => {
    // Both build/icon.icns and every file in build/icons/ are derived from this
    // one. The generator additionally asserts it is full-bleed and that its
    // alpha is not constant before it reads it — the check that matters most
    // here, because an opaque master is what Epona shipped until 2.7.2.
    expect(readHeader(join(BUILD, 'icon-square.png'))).toEqual({
      width: 1024,
      height: 1024,
      colorType: RGBA
    })
  })

  it('build/icon.png is the 1024 RGBA Windows master', () => {
    // Deliberately different artwork — the star. Nothing generates it, so this
    // only pins that it has not been replaced or folded into the square master.
    expect(readHeader(join(BUILD, 'icon.png'))).toEqual({
      width: 1024,
      height: 1024,
      colorType: RGBA
    })
  })

  it('build/icon.icns holds the ten expected entries', () => {
    // An icns is a header plus length-prefixed OSType chunks. Reading the type
    // list is enough to catch the failure that matters: a regeneration that
    // wrote a short set, which macOS resolves by scaling a neighbour rather
    // than by failing.
    const buf = readFileSync(join(BUILD, 'icon.icns'))
    expect(buf.subarray(0, 4).toString('ascii')).toBe('icns')
    expect(buf.readUInt32BE(4)).toBe(buf.length)

    const types = []
    for (let o = 8; o + 8 <= buf.length; ) {
      types.push(buf.subarray(o, o + 4).toString('ascii'))
      o += buf.readUInt32BE(o + 4)
    }
    expect(types).toEqual([
      'icp4',
      'icp5',
      'ic11',
      'ic12',
      'ic07',
      'ic13',
      'ic08',
      'ic14',
      'ic09',
      'ic10'
    ])
  })

  it('build/icons/ holds exactly the eight hicolor sizes and nothing else', () => {
    // "Nothing else" is load-bearing: electron-builder's collectIconsFromDir
    // matches /^(\d+)(?:x\d+)?\.png$/i over the whole directory, so a stray
    // 1024x1024.png left behind by a regeneration would be collected and
    // installed into a hicolor directory no desktop environment indexes — the
    // original defect, reintroduced beside the fix.
    const found = readdirSync(join(BUILD, 'icons')).sort()
    expect(found).toEqual(SIZES.map((s) => `${s}x${s}.png`).sort())
  })

  it.each(SIZES)('build/icons/%ix%i.png is square, RGBA, and its named size', (size) => {
    // The filename becomes the hicolor path, so a file whose name and contents
    // disagree installs correct-looking artwork at the wrong resolution.
    expect(readHeader(join(BUILD, 'icons', `${size}x${size}.png`))).toEqual({
      width: size,
      height: size,
      colorType: RGBA
    })
  })
})

// The hicolor set above is half of the taskbar icon. The other half is the
// config that installs it and ties the running window to the .desktop entry
// (HTOO-38, HTOO-63). This replaced the check by eye of the taskbar icon on the
// Linux box (Sabrael, 2026-11-02). A6 still reads the built .deb.
describe('the Linux icon config', () => {
  const builderYml = readFileSync(join(REPO_ROOT, 'electron-builder.yml'), 'utf8').replace(
    /\r\n/g,
    '\n'
  )
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'))

  /**
   * The keys of the top-level `linux:` block, comments excluded. Raw text, as in
   * portable-config.test.mjs: the repo has no YAML dependency of its own. Only
   * `  key: value` at exactly two spaces counts, and the next column-0 key ends
   * the block.
   */
  function linuxKeys() {
    const lines = builderYml.split('\n')
    const start = lines.indexOf('linux:')
    expect(start, 'electron-builder.yml has no top-level linux: block').toBeGreaterThan(-1)
    const keys = {}
    for (const line of lines.slice(start + 1)) {
      if (/^\S/.test(line)) break
      const found = /^ {2}([A-Za-z]+):\s*(.*?)\s*$/.exec(line)
      if (found) keys[found[1]] = found[2]
    }
    return keys
  }

  it('linux.icon points at build/icons, not a single file', () => {
    // A single PNG becomes one hicolor entry at its own size. With linux.icon
    // gone, mac.icon outranks the top-level icon and Linux gets the .icns.
    expect(linuxKeys().icon).toBe('build/icons')
  })

  it('the desktop-name pair is set on both sides', () => {
    // Without both, the desktop cannot tie the running window to epona.desktop,
    // and the taskbar draws a generic icon however correct build/icons/ is.
    expect(pkg.desktopName).toBe('epona.desktop')
    expect(linuxKeys().syncDesktopName).toBe('true')
  })

  it('the deb has a maintainer', () => {
    // The .deb installs the desktop entry and the icons, and electron-builder
    // fails the deb with no maintainer.
    expect(linuxKeys().maintainer).toMatch(/\S/)
  })
})
