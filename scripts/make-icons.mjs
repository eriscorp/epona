#!/usr/bin/env node
// Generate every derived icon artifact from ONE committed master.
//
//   build/icon-square.png  (committed, 1024x1024, full-bleed)
//        ├──> build/icon.icns      824x824 centred on 1024x1024, 10 entries  (macOS)
//        └──> build/icons/NxN.png  8 sizes, full-bleed                       (Linux)
//
// build/icon.png is NOT touched: it is the star, and it stays the WINDOWS
// artwork. build/portable-splash.bmp is composed from it (see the recipe in
// electron-builder.yml), so the icon and the NSIS extraction splash have to
// agree — which is the same reason balor kept its wreath on Windows.
//
// ── Why one generator and one master ──
//
// Epona used to have two masters and one generator: build/epona-mac-icon.png
// for macOS and build/icon.png for Windows AND Linux. Both halves were wrong.
//
// The Linux half is HTOO-38. electron-builder never resamples a single PNG —
// from app-builder-lib's iconConverter, a .png source returns as-is:
//
//   const { width, height } = await getPngSize(resolved)
//   return [{ file: resolved, size: Math.max(width, height) }]
//
// One PNG in, ONE hicolor entry out, at whatever size that file happens to be.
// hicolor's index.theme enumerates sizes up to 512, so the 1024x1024 master
// landed in a directory no desktop environment indexes and Epona drew the
// generic blank-document icon. That is what shipped through 2.7.2.
//
// The macOS half is quieter and is the reason this file replaces
// make-mac-icns.mjs rather than sitting beside it. build/epona-mac-icon.png was
// vendored from the macros set BEFORE its alpha was repaired: it is srgb with
// NO transparency, its rounded corners flattened to opaque black. The old
// script recovered the shape by flood-filling the four corners at 2% fuzz —
// which worked, and was measured against creidhne's genuine alpha (2.44%
// transparent vs 2.40%), but it is a repair standing in for a correct input,
// and it leaves a hard alpha edge where the source has a soft one.
//
// build/icon-square.png is the repaired variant, `Epona_fixed.png` from the
// macros set, downscaled 1254 -> 1024. Measured: 214 alpha levels, minima 0,
// bounding box 1024x1024+0+0 — real transparency, full-bleed. It is the same
// ARTWORK as the old mac master (RMSE 2.3%, all of it in the corners), so the
// Dock icon does not change picture; it only stops being reconstructed.
//
// Re-vendoring it is a one-off, so it lives here rather than in code — nothing
// in this repo can see the document repo, and hardcoding a path outside the
// checkout into a script that CI might one day run is worse than a comment:
//
//   magick <document repo>/docs/logos/macros/Epona_fixed.png -resize 1024x1024 \
//     -strip -define png:exclude-chunks=date,time -define png:compression-level=9 \
//     PNG32:build/icon-square.png
//
// Take the `_fixed` variant, never the plain `Epona.png` — that one is srgb with
// no alpha at all, and the guard below rejects it.
//
// ── Why the tile on Linux and not the star ──
//
// The invariant HTOO-38 is about is that every written size is FULL-BLEED, and
// the star satisfies it. But the house shape (balor, 2026-08-06) is that the
// square `_fixed` tile serves macOS AND Linux while the app's own artwork keeps
// Windows, and the desktops that matter here — Linux Mint's Cinnamon among them
// — draw square icons. A star with transparent corners reads as a smaller icon
// beside its square neighbours even when its bounding box is correct.
//
// One generator from one master also deletes a hazard rather than documenting
// it: the mac inset is something to ADD here, never something to undo, so there
// is no later -crop for a persisted -gravity to re-anchor. oghma needed three
// paragraphs on that trap because its only square artwork was already inset.
//
// Both outputs are COMMITTED, exactly as build/icon.icns already was, so CI
// never needs ImageMagick. build/ is directories.buildResources and is never
// packaged, so none of this reaches the app at run time.
//
// Requires ImageMagick 7 (`magick`). Regenerate after an artwork change:
//   node scripts/make-icons.mjs

import { execFileSync } from 'child_process'
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(repoRoot, 'build', 'icon-square.png')
const ICNS_OUT = join(repoRoot, 'build', 'icon.icns')
const LINUX_DIR = join(repoRoot, 'build', 'icons')

// The master must be exactly this, full-bleed. Asserted, not assumed.
const MASTER_SIZE = 1024
const MASTER_BBOX = `${MASTER_SIZE}x${MASTER_SIZE}+0+0`

// Apple's macOS app-icon grid: 824x824 of artwork centred in a 1024x1024
// canvas, i.e. a 100px margin. Without it the icon renders about 12% larger
// than every system icon beside it in the Dock.
const MAC_ART = 824
const MAC_INSET = (MASTER_SIZE - MAC_ART) / 2
const MAC_BBOX = `${MAC_ART}x${MAC_ART}+${MAC_INSET}+${MAC_INSET}`

// The modern icns set. Every entry is PNG data; `size` is the pixel dimension,
// and the @2x types repeat a dimension at a different OSType on purpose — a
// 32x32 image is both ic11 (16@2x) and icp5 (32@1x).
const ICNS_ENTRIES = [
  { type: 'icp4', size: 16 }, // 16x16
  { type: 'icp5', size: 32 }, // 32x32
  { type: 'ic11', size: 32 }, // 16x16@2x
  { type: 'ic12', size: 64 }, // 32x32@2x
  { type: 'ic07', size: 128 }, // 128x128
  { type: 'ic13', size: 256 }, // 128x128@2x
  { type: 'ic08', size: 256 }, // 256x256
  { type: 'ic14', size: 512 }, // 256x256@2x
  { type: 'ic09', size: 512 }, // 512x512
  { type: 'ic10', size: 1024 } // 512x512@2x
]

// The sizes electron-builder's collectIconsFromDir picks up. It matches
// /^(\d+)(?:x\d+)?\.png$/i, so `512x512.png` and `512.png` both work; the
// explicit form is used because it reads as the hicolor path it becomes.
const LINUX_SIZES = [16, 24, 32, 48, 64, 128, 256, 512]

// -strip ALONE IS NOT DETERMINISTIC: it leaves a tIME chunk holding the wall
// clock, so re-running rewrites every file with identical pixels and different
// bytes. These are committed artifacts, so identical input must give
// byte-identical output or every regeneration reads as a change.
const DETERMINISTIC = [
  '-strip',
  '-define',
  'png:exclude-chunks=date,time',
  '-define',
  'png:compression-level=9'
]

function magick(args) {
  return execFileSync('magick', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    .toString()
    .trim()
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

// ── Guard the master ────────────────────────────────────────────────────────
//
// Both checks measure the EXTRACTED ALPHA CHANNEL, and neither uses the two
// things that look like they would do the job. This matters more here than
// anywhere, because the input this rejects — an opaque master — is exactly what
// Epona was shipping until now:
//
//   - `%[channels]` reports `srgba` for a FULLY OPAQUE PNG32. The channel is
//     present; the transparency is not. A master "repaired" by flattening onto
//     black and re-saving sails through a channel-list check, and flattening is
//     what an image editor does by default on export.
//   - `%@` ON THE IMAGE is a TRIM bounding box, not an alpha one: it trims on
//     uniform border colour, so a flattened tile's black corners trim to the
//     same answer the real tile gives. Measured on balor's tile 2026-08-06,
//     both checks returned the right answer for the wrong reason, on the same
//     input, and agreed with each other while doing it.
//
// `-alpha extract` separates them: this master reports 214 levels and minima 0;
// the old build/epona-mac-icon.png reports 1 level and minima 1.
const alphaLevels = magick([SOURCE, '-alpha', 'extract', '-format', '%k', 'info:'])
const alphaMin = magick([SOURCE, '-alpha', 'extract', '-format', '%[fx:minima]', 'info:'])
if (alphaLevels === '1' || alphaMin !== '0') {
  fail(
    `build/icon-square.png has a constant or opaque alpha channel ` +
      `(levels=${alphaLevels}, minima=${alphaMin}).\n` +
      'Its rounded corners would render as a solid rectangle at every size.\n' +
      'Do NOT rescue it with `-transparent black` or a corner floodfill: both key out\n' +
      'artwork as well as background and leave a hard edge. Re-vendor the _fixed variant\n' +
      'from the document repo, which is where this master came from.'
  )
}

const masterGeometry = magick(['identify', '-format', '%wx%h', SOURCE])
if (masterGeometry !== `${MASTER_SIZE}x${MASTER_SIZE}`) {
  fail(
    `build/icon-square.png is ${masterGeometry}, expected ${MASTER_SIZE}x${MASTER_SIZE}.\n` +
      "The mac inset is computed from that size and would land off Apple's grid."
  )
}

const masterBbox = magick([SOURCE, '-alpha', 'extract', '-format', '%@', 'info:'])
if (masterBbox !== MASTER_BBOX) {
  fail(
    `build/icon-square.png has alpha bounding box ${masterBbox}, expected ${MASTER_BBOX}.\n` +
      'The master must be FULL-BLEED — an already-inset source would be inset twice for\n' +
      'macOS and would draw ~12% small at every Linux size, which passes a size check.'
  )
}

// ── macOS: add Apple's inset once, then scale that down ─────────────────────
//
// Insetting per size would round the padding differently at each step and
// wobble the artwork.
const work = mkdtempSync(join(tmpdir(), 'epona-icns-'))
try {
  const gridded = join(work, 'gridded.png')
  magick([
    SOURCE,
    '-resize',
    `${MAC_ART}x${MAC_ART}`,
    '-background',
    'none',
    '-gravity',
    'center',
    '-extent',
    `${MASTER_SIZE}x${MASTER_SIZE}`,
    ...DETERMINISTIC,
    `PNG32:${gridded}`
  ])

  const grid = magick([gridded, '-alpha', 'extract', '-format', '%@', 'info:'])
  if (grid !== MAC_BBOX) fail(`mac grid bbox ${grid}, expected ${MAC_BBOX}`)

  const chunks = []
  for (const { type, size } of ICNS_ENTRIES) {
    const png = join(work, `${type}.png`)
    magick([gridded, '-resize', `${size}x${size}`, ...DETERMINISTIC, `PNG32:${png}`])
    const data = readFileSync(png)

    // Each chunk is: OSType (4 bytes) + big-endian length (4 bytes, counting
    // this 8-byte header) + the PNG itself.
    const header = Buffer.alloc(8)
    header.write(type, 0, 4, 'ascii')
    header.writeUInt32BE(data.length + 8, 4)
    chunks.push(header, data)
  }

  const body = Buffer.concat(chunks)
  const fileHeader = Buffer.alloc(8)
  fileHeader.write('icns', 0, 4, 'ascii')
  fileHeader.writeUInt32BE(body.length + 8, 4)
  writeFileSync(ICNS_OUT, Buffer.concat([fileHeader, body]))

  console.log(
    `  icon.icns  ${String(body.length + 8).padStart(7)} bytes, ${ICNS_ENTRIES.length} entries`
  )
} finally {
  rmSync(work, { recursive: true, force: true })
}

// ── Linux: straight down, no crop ───────────────────────────────────────────
mkdirSync(LINUX_DIR, { recursive: true })
for (const size of LINUX_SIZES) {
  const out = join(LINUX_DIR, `${size}x${size}.png`)
  magick([SOURCE, '-resize', `${size}x${size}`, ...DETERMINISTIC, `PNG32:${out}`])
  console.log(`  icons/${size}x${size}.png  ${String(readFileSync(out).length).padStart(7)} bytes`)
}

// ── Verify what was written, rather than trusting the arguments ─────────────
//
// A size check alone is what let this defect ship across nine apps: an inset
// source passes it and still draws small. Assert the property directly, on the
// files as they now exist on disk.
for (const size of LINUX_SIZES) {
  const out = join(LINUX_DIR, `${size}x${size}.png`)
  const bbox = magick([out, '-alpha', 'extract', '-format', '%@', 'info:'])
  if (bbox !== `${size}x${size}+0+0`) {
    fail(`build/icons/${size}x${size}.png bbox ${bbox}, expected ${size}x${size}+0+0 (full-bleed)`)
  }
}

console.log(`\nVerified: mac inset ${MAC_BBOX}, all ${LINUX_SIZES.length} Linux sizes full-bleed.`)
