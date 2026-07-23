#!/usr/bin/env node
// Check the 7.41 runtime-patch address table against a real Darkages.exe.
//
//   node scripts/verify-client-patches.mjs "C:\\path\\to\\Darkages.exe"
//
// Read-only: nothing is launched and nothing is written. Run it when the address
// table changes, or before cutting a release that touches the ground-item hint
// patch — those addresses are valid for exactly one client build, and this is
// the cheapest proof that they still are.
//
// The client isn't in the repo, so this can't be a unit test. It resolves each
// RVA to a file offset through the PE section table rather than trusting the
// appendix's quoted offsets, so a mistake in either shows up.

import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { pathToFileURL } from 'url'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const { HOOKS, PREFERRED_IMAGE_BASE, STATIC_SELECTOR } = await import(
  pathToFileURL(join(here, '..', 'src', 'main', 'patches', 'sites741.js')).href
)

const EXPECTED_MD5 = '3244dc0e68cd26f4fb1626da3673fda8' // US Dark Ages 7.41

const exePath = process.argv[2]
if (!exePath) {
  console.error('usage: node scripts/verify-client-patches.mjs <path to Darkages.exe>')
  process.exit(2)
}

const image = readFileSync(exePath)
const md5 = createHash('md5').update(image).digest('hex')
console.log(`file  : ${exePath}`)
console.log(
  `md5   : ${md5} ${md5 === EXPECTED_MD5 ? '(7.41)' : '(NOT 7.41 — expected ' + EXPECTED_MD5 + ')'}`
)

// Walk the PE headers so RVAs can be mapped to file offsets independently.
function parsePe(buf) {
  const peOffset = buf.readUInt32LE(0x3c)
  const numberOfSections = buf.readUInt16LE(peOffset + 6)
  const sizeOfOptionalHeader = buf.readUInt16LE(peOffset + 20)
  const imageBase = buf.readUInt32LE(peOffset + 24 + 28)
  const sectionTable = peOffset + 24 + sizeOfOptionalHeader
  const sections = []
  for (let i = 0; i < numberOfSections; i++) {
    const off = sectionTable + i * 40
    sections.push({
      virtualAddress: buf.readUInt32LE(off + 12),
      sizeOfRawData: buf.readUInt32LE(off + 16),
      pointerToRawData: buf.readUInt32LE(off + 20)
    })
  }
  return { imageBase, sections }
}

const { imageBase, sections } = parsePe(image)
console.log(
  `base  : 0x${imageBase.toString(16)} (appendix assumes 0x${PREFERRED_IMAGE_BASE.toString(16)})\n`
)

const fileOffsetOf = (rva) => {
  const n = Number(rva)
  const s = sections.find((x) => n >= x.virtualAddress && n < x.virtualAddress + x.sizeOfRawData)
  if (!s) throw new Error(`RVA 0x${n.toString(16)} falls in no section`)
  return n - s.virtualAddress + s.pointerToRawData
}

let failures = 0
const check = (label, rva, expected) => {
  const offset = fileOffsetOf(rva)
  const actual = image.subarray(offset, offset + expected.length)
  const ok = actual.equals(expected)
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(32)} rva 0x${rva.toString(16)}`)
  if (!ok)
    console.log(
      `     expected ${expected.toString('hex')}\n     found    ${actual.toString('hex')}`
    )
}

for (const hook of Object.values(HOOKS)) check(hook.name, hook.rva, hook.displaced)
// Verified but never written — its survival is what proves SOTP full-hide,
// partial-hide and jungle-tree rendering are untouched by the patch.
check('static mode selector', STATIC_SELECTOR.rva, STATIC_SELECTOR.bytes)

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 && md5 === EXPECTED_MD5 ? 0 : 1)
