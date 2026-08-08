#!/usr/bin/env node
// Generate build/icons/NxN.png — the hicolor set electron-builder installs on Linux.
//
//   build/icon.png  (committed, 1024x1024, full-bleed — the star)
//        └──> build/icons/{16,24,32,48,64,128,256,512}x{N}.png
//
// WHY THIS EXISTS — electron-builder never resamples a single PNG. From
// app-builder-lib's iconConverter, a .png source comes back as-is:
//
//   const { width, height } = await getPngSize(resolved)
//   return [{ file: resolved, size: Math.max(width, height) }]
//
// One PNG in, ONE hicolor entry out, at whatever size that file happens to be.
// hicolor's index.theme enumerates sizes up to 512, so Epona's 1024x1024 master
// landed in a directory no desktop environment indexes, and the DE fell back to
// its generic blank-document icon. That is what shipped through 2.7.2. See
// HTOO-38 for the house-wide audit; nine of ten Electron apps had a variant of it.
//
// The related trap Epona does NOT have, stated so nobody "tidies" it back in:
// electron-builder resolves the Linux icon as [linux.icon, mac.icon ?? icon], so
// mac.icon OUTRANKS the top-level icon. Epona sets mac.icon (build/icon.icns —
// its own squircle artwork) and would ship THAT on Linux the moment linux.icon
// stopped being explicit. `buildResources/icons` is only a fallback, used when the
// primary source list is empty, which mac.icon guarantees it never is.
//
// ── Why the star and not the macOS squircle ──
//
// The invariant is that every written size is FULL-BLEED — the artwork reaching
// the edge of its canvas — so the icon draws at the same weight as its neighbours
// in an application menu. build/icon.png satisfies that already (alpha bbox
// 1024x1024+0+0), so there is nothing to crop and this script has no -crop step.
//
// build/epona-mac-icon.png would be the wrong source twice over: it is inset to
// Apple's 824-in-1024 grid, so every generated size would inherit a ~12%
// transparent margin and draw visibly small — the same defect in a subtler form,
// and one that passes a size check. It is also OPAQUE (its rounded corners are
// flattened to black), which is why make-mac-icns.mjs flood-fills them; carried
// through here that would render the squircle on a black rectangle.
//
// The outputs are COMMITTED, exactly as build/icon.icns already is, so CI never
// needs ImageMagick. build/ is directories.buildResources and is never packaged,
// so none of this reaches the app at run time.
//
// Requires ImageMagick 7 (`magick`). Regenerate after an artwork change:
//   node scripts/make-linux-icons.mjs

import { execFileSync } from 'child_process'
import { mkdirSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(repoRoot, 'build', 'icon.png')
const OUT_DIR = join(repoRoot, 'build', 'icons')

// The master must be exactly this, full-bleed. Asserted, not assumed.
const MASTER_SIZE = 1024
const MASTER_BBOX = `${MASTER_SIZE}x${MASTER_SIZE}+0+0`

// The sizes electron-builder's collectIconsFromDir picks up. It matches
// /^(\d+)(?:x\d+)?\.png$/i, so `512x512.png` and `512.png` both work; the
// explicit form is used because it reads as the hicolor path it becomes.
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512]

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
// things that look like they would do the job:
//
//   - `%[channels]` reports `srgba` for a FULLY OPAQUE PNG32. The channel is
//     present; the transparency is not. A master someone "repaired" by
//     flattening onto black and re-saving sails through a channel-list check —
//     the exact input the check exists to reject, and the likeliest one, because
//     flattening is what an image editor does by default on export.
//   - `%@` ON THE IMAGE is a TRIM bounding box, not an alpha one: it trims on
//     uniform border colour, so a flattened master's black corners trim to the
//     same answer a real one gives. Measured on balor's tile 2026-08-06: both
//     checks returned the right answer for the wrong reason, on the same input,
//     and agreed with each other while doing it.
//
// `-alpha extract` separates them — a real master has many alpha levels with a
// minimum of 0; a flattened one has exactly 1 level with a minimum of 1.
const alphaLevels = magick([SOURCE, '-alpha', 'extract', '-format', '%k', 'info:'])
const alphaMin = magick([SOURCE, '-alpha', 'extract', '-format', '%[fx:minima]', 'info:'])
if (alphaLevels === '1' || alphaMin !== '0') {
  fail(
    `build/icon.png has a constant or opaque alpha channel ` +
      `(levels=${alphaLevels}, minima=${alphaMin}).\n` +
      'Everything outside the star would render as a solid rectangle at every size.\n' +
      'Do NOT rescue it with `-transparent black`: that keys out artwork as well as\n' +
      'background and leaves an antialiased fringe. Re-export the master with real alpha.'
  )
}

const masterGeometry = magick(['identify', '-format', '%wx%h', SOURCE])
if (masterGeometry !== `${MASTER_SIZE}x${MASTER_SIZE}`) {
  fail(
    `build/icon.png is ${masterGeometry}, expected ${MASTER_SIZE}x${MASTER_SIZE}.\n` +
      'scripts/icons.test.mjs pins the same number; change both together.'
  )
}

const masterBbox = magick([SOURCE, '-alpha', 'extract', '-format', '%@', 'info:'])
if (masterBbox !== MASTER_BBOX) {
  fail(
    `build/icon.png has alpha bounding box ${masterBbox}, expected ${MASTER_BBOX}.\n` +
      'The master must be FULL-BLEED — an already-inset source draws ~12% small at every\n' +
      'Linux size, which passes a size check and is exactly the defect HTOO-38 is about.'
  )
}

// ── Write the set ───────────────────────────────────────────────────────────
mkdirSync(OUT_DIR, { recursive: true })
for (const size of SIZES) {
  const out = join(OUT_DIR, `${size}x${size}.png`)
  magick([SOURCE, '-resize', `${size}x${size}`, ...DETERMINISTIC, `PNG32:${out}`])
  console.log(`  ${size}x${size}.png  ${String(readFileSync(out).length).padStart(6)} bytes`)
}

// ── Verify what was written, rather than trusting the arguments ─────────────
//
// A size check alone is what let this defect ship across nine apps: an inset
// source passes it and still draws small. Assert the property directly, on the
// files as they now exist on disk.
for (const size of SIZES) {
  const out = join(OUT_DIR, `${size}x${size}.png`)
  const bbox = magick([out, '-alpha', 'extract', '-format', '%@', 'info:'])
  if (bbox !== `${size}x${size}+0+0`) {
    fail(`build/icons/${size}x${size}.png bbox ${bbox}, expected ${size}x${size}+0+0 (full-bleed)`)
  }
}

console.log(`\nVerified: all ${SIZES.length} sizes written and full-bleed.`)
