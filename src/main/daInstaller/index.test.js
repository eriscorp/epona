import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  installFromInstaller,
  downloadAndInstall,
  isCancellation,
  CACHED_INSTALLER_NAME,
  InstallError
} from './index.js'
import { EXPECTED_CLIENT_ARCHIVES } from '../daAssets.js'
import { buildWiseInstaller } from './wiseFixture.js'

let dir

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'epona-install-'))
})

afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true })
})

// A fixture that will pass verifyClientTree: every archive the check expects,
// with the retail installer's casing on the one that has any.
function completeClient(extra = []) {
  const archives = EXPECTED_CLIENT_ARCHIVES.map((name) => ({
    destFile: `%MAINDIR%\\${name === 'legend.dat' ? 'Legend.dat' : name}`,
    contents: Buffer.from(`${name} contents`)
  }))
  return [...archives, ...extra]
}

// Bytes deflate cannot shrink, from a fixed seed so the fixture is identical run
// to run. Used where a test needs the installer to be a certain SIZE.
function incompressible(length) {
  const out = Buffer.alloc(length)
  let state = 0x2545f491
  for (let i = 0; i < length; i++) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    out[i] = state & 0xff
  }
  return out
}

async function writeInstaller(files) {
  const path = join(dir, 'DarkAges741single.exe')
  await fs.writeFile(path, buildWiseInstaller(files).buffer)
  return path
}

describe('installFromInstaller', () => {
  it('unpacks a client tree from an installer the user already has', async () => {
    // The pre-downloaded path: no network involved at all.
    const installer = await writeInstaller(
      completeClient([
        { destFile: '%MAINDIR%\\npc\\npcbase.dat', contents: Buffer.from('npc') },
        { destFile: '%MAINDIR%\\Darkages.exe', contents: Buffer.from('client') }
      ])
    )
    const destination = join(dir, 'DarkAges')

    const result = await installFromInstaller({
      installerPath: installer,
      destinationDir: destination
    })

    expect(result.filesWritten).toBe(12)
    expect(result.verification).toMatchObject({ ok: true, complete: true })
    expect(await fs.readFile(join(destination, 'Legend.dat'), 'utf8')).toBe('legend.dat contents')
    expect(await fs.readFile(join(destination, 'npc', 'npcbase.dat'), 'utf8')).toBe('npc')
  })

  it('reports where the client executable landed', async () => {
    // Consumed by the Windows path, where clientPath is a FILE rather than a
    // directory. Reported rather than acted on: which one clientPath wants is the
    // consumer's contract, not this module's.
    const installer = await writeInstaller(
      completeClient([{ destFile: '%MAINDIR%\\Darkages.exe', contents: Buffer.from('MZ client') }])
    )
    const destination = join(dir, 'DarkAges')

    const result = await installFromInstaller({
      installerPath: installer,
      destinationDir: destination
    })

    // The one-word capital-D spelling the retail installer actually writes — not
    // 'Dark Ages.exe', which is what a hand-picked file tends to be called.
    expect(result.executablePath).toBe(join(destination, 'Darkages.exe'))
  })

  it('reports no executable when the installer carried none', async () => {
    const installer = await writeInstaller(completeClient())
    const result = await installFromInstaller({
      installerPath: installer,
      destinationDir: join(dir, 'DarkAges')
    })
    expect(result.executablePath).toBeNull()
  })

  it('reports the phases a caller needs to narrate', async () => {
    const installer = await writeInstaller(completeClient())
    const phases = new Set()
    await installFromInstaller({
      installerPath: installer,
      destinationDir: join(dir, 'DarkAges'),
      onProgress: (p) => phases.add(p.phase)
    })
    expect([...phases]).toEqual(expect.arrayContaining(['read', 'extract', 'verify']))
  })

  it('refuses a file that is not an installer, and says which problem it is', async () => {
    const notAnInstaller = join(dir, 'holiday.jpg')
    await fs.writeFile(notAnInstaller, 'not an executable')
    await expect(
      installFromInstaller({ installerPath: notAnInstaller, destinationDir: join(dir, 'out') })
    ).rejects.toMatchObject({ reason: 'not-an-installer' })
  })

  it('reports a missing installer file distinctly from a bad one', async () => {
    await expect(
      installFromInstaller({
        installerPath: join(dir, 'nope.exe'),
        destinationDir: join(dir, 'out')
      })
    ).rejects.toMatchObject({ reason: 'installer-missing' })
  })

  it('refuses when nothing was chosen', async () => {
    await expect(installFromInstaller({ destinationDir: join(dir, 'out') })).rejects.toMatchObject({
      reason: 'no-installer'
    })
    await expect(installFromInstaller({ installerPath: 'x.exe' })).rejects.toMatchObject({
      reason: 'no-destination'
    })
  })

  it('fails verification rather than accepting a tree missing core archives', async () => {
    // An installer that unpacks cleanly but does not carry a full client. The
    // extraction succeeds and the card's acceptance gate is what catches it.
    const installer = await writeInstaller([
      { destFile: '%MAINDIR%\\Legend.dat', contents: Buffer.from('only one archive') }
    ])
    await expect(
      installFromInstaller({ installerPath: installer, destinationDir: join(dir, 'DarkAges') })
    ).rejects.toMatchObject({ reason: 'verification-failed' })
  })

  it('names the missing archives when verification fails', async () => {
    const installer = await writeInstaller([
      { destFile: '%MAINDIR%\\Legend.dat', contents: Buffer.from('one') }
    ])
    await expect(
      installFromInstaller({ installerPath: installer, destinationDir: join(dir, 'DarkAges') })
    ).rejects.toThrow(/setoa\.dat/)
  })

  it('refuses an installer carrying no client files at all', async () => {
    const installer = await writeInstaller([
      { destFile: '%TEMP%\\%READMEFILE%', contents: Buffer.from('readme') }
    ])
    await expect(
      installFromInstaller({ installerPath: installer, destinationDir: join(dir, 'DarkAges') })
    ).rejects.toMatchObject({ reason: 'no-client-files' })
  })

  it('surfaces entries it could not confirm alongside a successful install', async () => {
    // A tree can be usable and still be short of something. Reporting it beats
    // discovering it later, and beats failing an otherwise good install.
    const installer = await writeInstaller(
      completeClient([
        { destFile: '%MAINDIR%\\bad.dat', contents: Buffer.from('x'), crcOverride: 0xdeadbeef }
      ])
    )
    const result = await installFromInstaller({
      installerPath: installer,
      destinationDir: join(dir, 'DarkAges')
    })
    expect(result.verification.ok).toBe(true)
    expect(result.skipped).toEqual([{ destFile: '%MAINDIR%\\bad.dat', reason: 'crc-unconfirmed' }])
  })
})

describe('downloadAndInstall', () => {
  function serveInstaller(buffer) {
    return async (url, options = {}) => {
      const headers = new Map([
        ['content-length', String(buffer.length)],
        ['etag', '"fixture"']
      ])
      return {
        ok: true,
        status: 200,
        url: 'https://host/DarkAges741single.exe',
        headers: { get: (n) => headers.get(n.toLowerCase()) ?? null },
        text: async () => '',
        body:
          options.method === 'HEAD'
            ? null
            : new ReadableStream({
                start(c) {
                  c.enqueue(new Uint8Array(buffer))
                  c.close()
                }
              })
      }
    }
  }

  it('downloads then unpacks, caching the installer under a stable name', async () => {
    const buffer = buildWiseInstaller(completeClient()).buffer
    const cacheDir = join(dir, 'cache')
    await fs.mkdir(cacheDir)
    const destination = join(dir, 'DarkAges')

    const result = await downloadAndInstall({
      cacheDir,
      destinationDir: destination,
      url: 'https://host/DarkAges741single.exe',
      fetchImpl: serveInstaller(buffer)
    })

    expect(result.download).toMatchObject({ reused: false })
    expect(result.verification.ok).toBe(true)
    // Cached under a fixed name, so a second run can find and reuse it.
    expect(await fs.readdir(cacheDir)).toContain(CACHED_INSTALLER_NAME)
    expect(await fs.readFile(join(destination, 'Legend.dat'), 'utf8')).toBe('legend.dat contents')
  })

  it('reuses the cached installer on a second run', async () => {
    // The installer has to clear the downloader's reuse floor, which exists to
    // stop a saved error page being reused forever. Deflate would squash a run of
    // one byte to nothing, so the filler is incompressible.
    const buffer = buildWiseInstaller(
      completeClient([{ destFile: '%MAINDIR%\\bulk.dat', contents: incompressible(1200 * 1024) }])
    ).buffer
    expect(buffer.length).toBeGreaterThan(1024 * 1024)

    const cacheDir = join(dir, 'cache')
    await fs.mkdir(cacheDir)
    const fetchImpl = serveInstaller(buffer)

    await downloadAndInstall({
      cacheDir,
      destinationDir: join(dir, 'first'),
      url: 'u',
      fetchImpl
    })
    const second = await downloadAndInstall({
      cacheDir,
      destinationDir: join(dir, 'second'),
      url: 'u',
      fetchImpl
    })
    expect(second.download.reused).toBe(true)
  })

  it('refuses without a download folder', async () => {
    await expect(
      downloadAndInstall({ destinationDir: join(dir, 'out'), url: 'u' })
    ).rejects.toBeInstanceOf(InstallError)
  })
})

describe('isCancellation', () => {
  it('tells a user-initiated stop apart from a fault', async () => {
    const installer = await writeInstaller(completeClient())
    const controller = new AbortController()
    controller.abort()
    try {
      await installFromInstaller({
        installerPath: installer,
        destinationDir: join(dir, 'DarkAges'),
        signal: controller.signal
      })
      throw new Error('should have thrown')
    } catch (error) {
      expect(isCancellation(error)).toBe(true)
    }
  })

  it('does not treat a real failure as a cancellation', () => {
    expect(isCancellation(new InstallError('broken', 'not-an-installer'))).toBe(false)
    expect(isCancellation(new Error('anything'))).toBe(false)
  })
})
