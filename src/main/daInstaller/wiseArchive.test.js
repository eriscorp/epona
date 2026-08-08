import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { readWiseManifest, NotAWiseInstallerError } from './wiseArchive.js'
import { buildWiseInstaller } from './wiseFixture.js'

let dir

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'epona-wise-'))
})

afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true })
})

async function writeInstaller(files, options) {
  const fixture = buildWiseInstaller(files, options)
  const path = join(dir, 'setup.exe')
  await fs.writeFile(path, fixture.buffer)
  return { path, fixture }
}

const CLIENT = [
  { destFile: '%MAINDIR%\\Legend.dat', contents: Buffer.from('legend archive bytes') },
  { destFile: '%MAINDIR%\\setoa.dat', contents: Buffer.from('setoa archive bytes') },
  { destFile: '%MAINDIR%\\npc\\npcbase.dat', contents: Buffer.from('npc base bytes') }
]

describe('readWiseManifest', () => {
  it('reads the file table out of a Wise installer', async () => {
    const { path, fixture } = await writeInstaller(CLIENT)
    const manifest = await readWiseManifest(path)

    expect(manifest.overlayOffset).toBe(fixture.overlayOffset)
    expect(manifest.clientFiles.map((f) => f.relativePath)).toEqual([
      'Legend.dat',
      'setoa.dat',
      'npc/npcbase.dat'
    ])
    expect(manifest.skipped).toEqual([])
  })

  it('locates the data base past the Wise header and the leading streams', async () => {
    // deflateStart values are measured from the first FILE stream, which sits
    // after a variable-length Wise header, the palette bitmap and the script. Get
    // this wrong and every byte range is off. Nothing else in the file states it.
    const { path, fixture } = await writeInstaller(CLIENT)
    const manifest = await readWiseManifest(path)
    expect(manifest.dataBase).toBe(fixture.dataBase)
    expect(manifest.dataBase).toBeGreaterThan(fixture.overlayOffset)
  })

  it('separates client files from the installer’s own entries', async () => {
    const { path } = await writeInstaller([
      { destFile: '%TEMP%\\%READMEFILE%', contents: Buffer.from('readme') },
      ...CLIENT,
      { destFile: '%UNINSTALL_PATH%', contents: Buffer.from('uninstaller') }
    ])
    const manifest = await readWiseManifest(path)
    expect(manifest.entries).toHaveLength(5)
    expect(manifest.clientFiles).toHaveLength(3)
  })

  it('drops an entry whose recorded checksum disagrees with its bytes', async () => {
    // The scan in wiseScript.js is deliberately loose, so this is the check that
    // makes it sound. A candidate the installer's own CRC32 does not vouch for
    // must not reach the extractor.
    const { path } = await writeInstaller([
      ...CLIENT,
      {
        destFile: '%MAINDIR%\\corrupt.dat',
        contents: Buffer.from('bytes that do not match'),
        crcOverride: 0x11223344
      }
    ])
    const manifest = await readWiseManifest(path)
    expect(manifest.clientFiles.map((f) => f.relativePath)).not.toContain('corrupt.dat')
    expect(manifest.skipped).toEqual([
      { destFile: '%MAINDIR%\\corrupt.dat', reason: 'crc-unconfirmed' }
    ])
  })

  it('reports an unconfirmed client file rather than shipping a short tree', async () => {
    const { path } = await writeInstaller([
      ...CLIENT,
      { destFile: '%MAINDIR%\\bad.dat', contents: Buffer.from('x'), crcOverride: 0x99999999 }
    ])
    const manifest = await readWiseManifest(path)
    expect(manifest.skipped).toHaveLength(1)
    expect(manifest.skipped[0].destFile).toContain('bad.dat')
  })

  it('keeps only the first record for a duplicated destination', async () => {
    const same = Buffer.from('one copy of the bytes')
    const { path } = await writeInstaller([
      ...CLIENT,
      { destFile: '%MAINDIR%\\Legend.dat', contents: same }
    ])
    const manifest = await readWiseManifest(path)
    const legend = manifest.clientFiles.filter((f) => f.relativePath === 'Legend.dat')
    expect(legend).toHaveLength(1)
  })

  it('refuses a file that is not an executable at all', async () => {
    const path = join(dir, 'notes.txt')
    await fs.writeFile(path, 'this is not an installer')
    await expect(readWiseManifest(path)).rejects.toThrow(/Not a Windows executable/)
  })

  it('refuses an executable with nothing appended to it', async () => {
    const { fixture } = await writeInstaller(CLIENT)
    const stubOnly = join(dir, 'stub.exe')
    await fs.writeFile(stubOnly, fixture.buffer.subarray(0, fixture.overlayOffset))
    await expect(readWiseManifest(stubOnly)).rejects.toThrow(NotAWiseInstallerError)
  })

  it('refuses an executable whose overlay is not a Wise payload', async () => {
    const { fixture } = await writeInstaller(CLIENT)
    const junk = Buffer.concat([
      fixture.buffer.subarray(0, fixture.overlayOffset),
      Buffer.alloc(4096, 0x5a)
    ])
    const path = join(dir, 'junk.exe')
    await fs.writeFile(path, junk)
    await expect(readWiseManifest(path)).rejects.toThrow(NotAWiseInstallerError)
  })

  it('carries a reason a caller can branch on', async () => {
    const path = join(dir, 'notes.txt')
    await fs.writeFile(path, 'nope')
    await expect(readWiseManifest(path)).rejects.toMatchObject({ reason: 'not-an-executable' })
  })
})
