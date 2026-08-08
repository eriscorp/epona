import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'

// build/icons/ is GENERATED but COMMITTED — CI has no ImageMagick, so
// electron-builder reads whatever is in the tree. That makes it exactly the kind
// of thing that goes stale silently: change build/icon.png, forget
// `node scripts/make-linux-icons.mjs`, and the build stays green while the .deb
// ships the previous artwork at the previous sizes.
//
// This reads PNG headers directly rather than shelling out, so it needs no
// ImageMagick and runs in the ordinary suite. It therefore checks the two
// properties a header carries — geometry and colour type — and NOT the alpha
// bounding box, which needs pixel decoding. make-linux-icons.mjs asserts the
// bounding boxes itself, at the moment it writes them, which is where the check
// that needs a decoder belongs.
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
  it('build/icon.png is the 1024 RGBA Windows/Linux master', () => {
    // Every file in build/icons/ is derived from this one. The generator
    // additionally asserts it is full-bleed before it reads it.
    expect(readHeader(join(BUILD, 'icon.png'))).toEqual({
      width: 1024,
      height: 1024,
      colorType: RGBA
    })
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
