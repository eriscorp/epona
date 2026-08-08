import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { readWiseManifest } from './wiseArchive.js'
import { extractClientFiles, ExtractionError, ExtractionCancelledError } from './wiseExtract.js'
import { buildWiseInstaller } from './wiseFixture.js'

let dir

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'epona-extract-'))
})

afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true })
})

const CLIENT = [
  { destFile: '%MAINDIR%\\Legend.dat', contents: Buffer.from('legend archive bytes') },
  { destFile: '%MAINDIR%\\setoa.dat', contents: Buffer.from('setoa archive bytes') },
  { destFile: '%MAINDIR%\\npc\\npcbase.dat', contents: Buffer.from('npc base bytes') },
  { destFile: '%MAINDIR%\\Darkages.exe', contents: Buffer.from('MZ fake client') }
]

async function prepare(files = CLIENT) {
  const fixture = buildWiseInstaller(files)
  const installer = join(dir, 'setup.exe')
  await fs.writeFile(installer, fixture.buffer)
  const manifest = await readWiseManifest(installer)
  return { installer, manifest, destination: join(dir, 'DarkAges') }
}

async function listTree(root, prefix = '') {
  const out = []
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...(await listTree(join(root, entry.name), rel)))
    else out.push(rel)
  }
  return out.sort()
}

describe('extractClientFiles', () => {
  it('writes every client file with its contents intact', async () => {
    const { installer, manifest, destination } = await prepare()
    const result = await extractClientFiles(installer, manifest, destination)

    expect(result.filesWritten).toBe(4)
    expect(await listTree(destination)).toEqual([
      'Darkages.exe',
      'Legend.dat',
      'npc/npcbase.dat',
      'setoa.dat'
    ])
    expect(await fs.readFile(join(destination, 'Legend.dat'), 'utf8')).toBe('legend archive bytes')
    expect(await fs.readFile(join(destination, 'npc', 'npcbase.dat'), 'utf8')).toBe(
      'npc base bytes'
    )
  })

  it('preserves the installer’s mixed-case filenames byte for byte', async () => {
    // The reason this feature exists is Linux, where a folded name stops
    // resolving. Asserting on the directory listing rather than on a stat() is
    // deliberate: on macOS and Windows a stat of the wrong case still succeeds,
    // so a stat-based test would pass on a tree this check is meant to reject.
    const { installer, manifest, destination } = await prepare([
      { destFile: '%MAINDIR%\\Legend.dat', contents: Buffer.from('a') },
      { destFile: '%MAINDIR%\\setoa.dat', contents: Buffer.from('b') },
      { destFile: '%MAINDIR%\\DA-DisplaySelector.exe', contents: Buffer.from('c') },
      { destFile: '%MAINDIR%\\adventure\\SpellBook.cfg', contents: Buffer.from('d') }
    ])
    await extractClientFiles(installer, manifest, destination)

    const listed = await listTree(destination)
    expect(listed).toContain('Legend.dat')
    expect(listed).toContain('DA-DisplaySelector.exe')
    expect(listed).toContain('adventure/SpellBook.cfg')
    expect(listed).not.toContain('legend.dat')
    expect(listed).not.toContain('da-displayselector.exe')
  })

  it('reports progress that adds up to the whole tree', async () => {
    const { installer, manifest, destination } = await prepare()
    const seen = []
    await extractClientFiles(installer, manifest, destination, {
      onProgress: (p) => seen.push(p)
    })

    expect(seen).toHaveLength(4)
    expect(seen.at(-1)).toMatchObject({ filesDone: 4, filesTotal: 4 })
    expect(seen.at(-1).bytesDone).toBe(seen.at(-1).totalBytes)
    // Monotonic, so a progress bar never goes backwards.
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i].bytesDone).toBeGreaterThan(seen[i - 1].bytesDone)
    }
  })

  it('leaves the destination untouched when a file fails its checksum', async () => {
    // A tree with some files in it is exactly the shape inspectAssetDir accepts,
    // so a failed extraction must not leave one behind.
    const { installer, manifest, destination } = await prepare()
    const broken = {
      ...manifest,
      clientFiles: manifest.clientFiles.map((f, i) => (i === 2 ? { ...f, crc32: 0x12345678 } : f))
    }

    await expect(extractClientFiles(installer, broken, destination)).rejects.toThrow(
      ExtractionError
    )
    await expect(fs.stat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('removes its staging directory when it fails', async () => {
    const { installer, manifest, destination } = await prepare()
    const broken = {
      ...manifest,
      clientFiles: manifest.clientFiles.map((f) => ({ ...f, inflatedSize: f.inflatedSize + 1 }))
    }
    await expect(extractClientFiles(installer, broken, destination)).rejects.toMatchObject({
      reason: 'size-mismatch'
    })
    // Nothing left beside the destination either.
    expect(await fs.readdir(dir)).toEqual(['setup.exe'])
  })

  it('fails when an entry does not inflate at all', async () => {
    const { installer, manifest, destination } = await prepare()
    const broken = {
      ...manifest,
      // Point an entry at bytes that are not a deflate stream.
      clientFiles: [{ ...manifest.clientFiles[0], deflateStart: 3, deflateEnd: 40 }]
    }
    await expect(extractClientFiles(installer, broken, destination)).rejects.toMatchObject({
      reason: 'inflate-failed'
    })
  })

  it('stops when cancelled and writes nothing into the destination', async () => {
    const { installer, manifest, destination } = await prepare()
    const controller = new AbortController()
    controller.abort()

    await expect(
      extractClientFiles(installer, manifest, destination, { signal: controller.signal })
    ).rejects.toThrow(ExtractionCancelledError)
    await expect(fs.stat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('cancels partway through without promoting a partial tree', async () => {
    const { installer, manifest, destination } = await prepare()
    const controller = new AbortController()

    await expect(
      extractClientFiles(installer, manifest, destination, {
        signal: controller.signal,
        onProgress: ({ filesDone }) => {
          if (filesDone === 2) controller.abort()
        }
      })
    ).rejects.toMatchObject({ reason: 'cancelled' })
    await expect(fs.stat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('merges into a destination that already has files in it', async () => {
    const { installer, manifest, destination } = await prepare()
    await fs.mkdir(destination, { recursive: true })
    await fs.writeFile(join(destination, 'user-notes.txt'), 'keep me')

    await extractClientFiles(installer, manifest, destination)
    const listed = await listTree(destination)
    expect(listed).toContain('Legend.dat')
    expect(listed).toContain('user-notes.txt')
  })

  it('refuses an installer that lists no client files', async () => {
    const { installer, destination } = await prepare()
    await expect(
      extractClientFiles(installer, { dataBase: 0, clientFiles: [] }, destination)
    ).rejects.toMatchObject({ reason: 'no-client-files' })
  })
})
