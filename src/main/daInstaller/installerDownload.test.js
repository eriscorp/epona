import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  downloadInstaller,
  resolveInstallerUrl,
  DownloadError,
  DownloadCancelledError,
  DOWNLOAD_PAGE_URL,
  FALLBACK_INSTALLER_URL
} from './installerDownload.js'

let dir

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'epona-dl-'))
})

afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true })
})

function response({
  status = 200,
  headers = {},
  body = null,
  text = '',
  url = 'https://host/i.exe'
}) {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]))
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: (name) => lower.get(name.toLowerCase()) ?? null },
    text: async () => text,
    body:
      body === null
        ? null
        : new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(body))
              controller.close()
            }
          })
  }
}

// A stand-in for the installer. Size checks are driven by content-length, so this
// only has to be self-consistent — but it must clear the reuse floor, because the
// reuse path is one of the things under test.
const PAYLOAD = Buffer.alloc(2 * 1024 * 1024, 0x41)

// Serves HEAD then GET, honouring Range, and records what it was asked for.
function server({
  payload = PAYLOAD,
  etag = '"abc"',
  lastModified = 'Fri, 01 Apr 2016 02:37:08 GMT',
  ignoreRange = false
} = {}) {
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method ?? 'GET', headers: options.headers ?? {} })
    if (options.signal?.aborted) {
      const error = new Error('aborted')
      error.name = 'AbortError'
      throw error
    }
    if (options.method === 'HEAD') {
      return response({
        url,
        headers: { 'content-length': payload.length, etag, 'last-modified': lastModified }
      })
    }
    const range = options.headers?.Range
    if (range && !ignoreRange) {
      const from = Number(/bytes=(\d+)-/.exec(range)[1])
      return response({
        url,
        status: 206,
        headers: { 'content-length': payload.length - from },
        body: payload.subarray(from)
      })
    }
    return response({ url, headers: { 'content-length': payload.length }, body: payload })
  }
  return { fetchImpl, calls }
}

describe('resolveInstallerUrl', () => {
  it('reads the installer link off the download page', async () => {
    const fetchImpl = async (url) => {
      expect(url).toBe(DOWNLOAD_PAGE_URL)
      return response({
        text: '<a href="https://s3.amazonaws.com/kru-downloads/da/DarkAges999single.exe">get</a>'
      })
    }
    await expect(resolveInstallerUrl({ fetchImpl })).resolves.toEqual({
      url: 'https://s3.amazonaws.com/kru-downloads/da/DarkAges999single.exe',
      resolved: true
    })
  })

  it('ignores the incremental patch installers on the same page', async () => {
    // The page lists DarkAges740-741patch.exe beside the full installer. A patch
    // is not a usable source tree, so matching it would be worse than failing.
    const fetchImpl = async () =>
      response({
        text: `<a href="https://s3.amazonaws.com/kru-downloads/da/DarkAges740-741patch.exe">patch</a>
               <a href="https://s3.amazonaws.com/kru-downloads/da/DarkAges741single.exe">full</a>`
      })
    const result = await resolveInstallerUrl({ fetchImpl })
    expect(result.url).toContain('741single.exe')
    expect(result.url).not.toContain('patch')
  })

  it('falls back to the pinned URL when the page cannot be read', async () => {
    const fetchImpl = async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })
    }
    await expect(resolveInstallerUrl({ fetchImpl })).resolves.toEqual({
      url: FALLBACK_INSTALLER_URL,
      resolved: false
    })
  })

  it('falls back when the page no longer links an installer', async () => {
    const fetchImpl = async () => response({ text: '<p>coming soon</p>' })
    await expect(resolveInstallerUrl({ fetchImpl })).resolves.toMatchObject({ resolved: false })
  })

  it('falls back on an error status rather than treating the page as HTML', async () => {
    const fetchImpl = async () => response({ status: 403, text: 'Forbidden' })
    await expect(resolveInstallerUrl({ fetchImpl })).resolves.toMatchObject({ resolved: false })
  })
})

describe('downloadInstaller', () => {
  const destination = () => join(dir, 'DarkAges-installer.exe')

  it('downloads to the destination and records what it fetched', async () => {
    const { fetchImpl } = server()
    const result = await downloadInstaller({
      destinationPath: destination(),
      url: 'https://host/i.exe',
      fetchImpl
    })

    expect(result).toMatchObject({ bytes: PAYLOAD.length, reused: false })
    expect((await fs.readFile(destination())).equals(PAYLOAD)).toBe(true)
    const meta = JSON.parse(await fs.readFile(`${destination()}.meta.json`, 'utf8'))
    expect(meta).toMatchObject({ etag: '"abc"', bytes: PAYLOAD.length })
  })

  it('resolves the URL from the download page when none is given', async () => {
    const { fetchImpl, calls } = server()
    await downloadInstaller({ destinationPath: destination(), fetchImpl })
    expect(calls[0].url).toBe(DOWNLOAD_PAGE_URL)
  })

  it('leaves no .part file behind on success', async () => {
    const { fetchImpl } = server()
    await downloadInstaller({ destinationPath: destination(), url: 'u', fetchImpl })
    expect(await fs.readdir(dir)).toEqual([
      'DarkAges-installer.exe',
      'DarkAges-installer.exe.meta.json'
    ])
  })

  it('reuses a complete download when the validators still agree', async () => {
    const { fetchImpl, calls } = server()
    await downloadInstaller({ destinationPath: destination(), url: 'u', fetchImpl })
    const first = calls.length

    const again = await downloadInstaller({ destinationPath: destination(), url: 'u', fetchImpl })
    expect(again.reused).toBe(true)
    // One HEAD to check, and no GET of the body.
    expect(calls.slice(first).filter((c) => c.method === 'GET')).toEqual([])
  })

  it('re-downloads when the server’s ETag has changed', async () => {
    const { fetchImpl } = server()
    await downloadInstaller({ destinationPath: destination(), url: 'u', fetchImpl })

    const republished = server({ payload: Buffer.alloc(4096, 0x42), etag: '"different"' })
    const result = await downloadInstaller({
      destinationPath: destination(),
      url: 'u',
      fetchImpl: republished.fetchImpl
    })
    expect(result.reused).toBe(false)
    expect((await fs.readFile(destination())).equals(Buffer.alloc(4096, 0x42))).toBe(true)
  })

  it('resumes from a partial download instead of starting over', async () => {
    await fs.writeFile(`${destination()}.part`, PAYLOAD.subarray(0, 1000))
    const { fetchImpl, calls } = server()

    const result = await downloadInstaller({ destinationPath: destination(), url: 'u', fetchImpl })
    expect(result.bytes).toBe(PAYLOAD.length)
    expect((await fs.readFile(destination())).equals(PAYLOAD)).toBe(true)
    const get = calls.find((c) => c.method === 'GET')
    expect(get.headers.Range).toBe('bytes=1000-')
  })

  it('starts over when the server ignores the range request', async () => {
    // Appending a full body onto a partial file would produce a longer file that
    // looks complete and is corrupt.
    await fs.writeFile(`${destination()}.part`, PAYLOAD.subarray(0, 1000))
    const { fetchImpl } = server({ ignoreRange: true })

    const result = await downloadInstaller({ destinationPath: destination(), url: 'u', fetchImpl })
    expect(result.bytes).toBe(PAYLOAD.length)
    expect((await fs.readFile(destination())).equals(PAYLOAD)).toBe(true)
  })

  it('discards a partial download fetched under different validators', async () => {
    await fs.writeFile(`${destination()}.part`, Buffer.alloc(1000, 0x5a))
    await fs.writeFile(`${destination()}.part.meta.json`, JSON.stringify({ etag: '"stale"' }))
    const { fetchImpl } = server()

    await downloadInstaller({ destinationPath: destination(), url: 'u', fetchImpl })
    expect((await fs.readFile(destination())).equals(PAYLOAD)).toBe(true)
  })

  it('does not promote a truncated transfer to the destination', async () => {
    // The failure this exists for: a body that ends early without raising. A
    // short file at the destination would then be handed to the extractor and
    // fail there, a long way from the cause.
    const fetchImpl = async (url, options = {}) => {
      if (options.method === 'HEAD') {
        return response({ url, headers: { 'content-length': 4096, etag: '"abc"' } })
      }
      return response({ url, headers: { 'content-length': 4096 }, body: PAYLOAD.subarray(0, 100) })
    }

    await expect(
      downloadInstaller({ destinationPath: destination(), url: 'u', fetchImpl })
    ).rejects.toMatchObject({ reason: 'truncated' })
    await expect(fs.stat(destination())).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps the .part file after a truncated transfer so the next run resumes', async () => {
    const fetchImpl = async (url, options = {}) => {
      if (options.method === 'HEAD') {
        return response({ url, headers: { 'content-length': 4096, etag: '"abc"' } })
      }
      return response({ url, headers: { 'content-length': 4096 }, body: PAYLOAD.subarray(0, 100) })
    }
    await expect(
      downloadInstaller({ destinationPath: destination(), url: 'u', fetchImpl })
    ).rejects.toThrow(DownloadError)
    expect(await fs.readdir(dir)).toContain('DarkAges-installer.exe.part')
  })

  it('will not reuse an implausibly small existing file', async () => {
    // A saved error page is the realistic case. It must not be mistaken for the
    // installer just because a length happens to line up.
    await fs.writeFile(destination(), Buffer.alloc(512, 0x41))
    const fetchImpl = async (url, options = {}) => {
      if (options.method === 'HEAD') {
        return response({ url, headers: { 'content-length': 512, etag: '"abc"' } })
      }
      return response({ url, headers: { 'content-length': 512 }, body: Buffer.alloc(512, 0x41) })
    }
    const result = await downloadInstaller({ destinationPath: destination(), url: 'u', fetchImpl })
    expect(result.reused).toBe(false)
  })

  it('reports an unreachable host in words a user can act on', async () => {
    const fetchImpl = async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })
    }
    await expect(
      downloadInstaller({
        destinationPath: destination(),
        url: 'https://darkages.test/i.exe',
        fetchImpl
      })
    ).rejects.toMatchObject({ reason: 'offline' })
  })

  it('reports an interrupted connection separately from being offline', async () => {
    const fetchImpl = async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })
    }
    await expect(
      downloadInstaller({
        destinationPath: destination(),
        url: 'https://darkages.test/i.exe',
        fetchImpl
      })
    ).rejects.toMatchObject({ reason: 'interrupted' })
  })

  it('reports an HTTP error status', async () => {
    const fetchImpl = async () => response({ status: 404 })
    await expect(
      downloadInstaller({ destinationPath: destination(), url: 'u', fetchImpl })
    ).rejects.toMatchObject({ reason: 'http-status' })
  })

  it('reports cancellation as cancellation, not as a network fault', async () => {
    const controller = new AbortController()
    controller.abort()
    const { fetchImpl } = server()
    await expect(
      downloadInstaller({
        destinationPath: destination(),
        url: 'u',
        fetchImpl,
        signal: controller.signal
      })
    ).rejects.toThrow(DownloadCancelledError)
  })

  it('refuses to run without a destination', async () => {
    await expect(
      downloadInstaller({ url: 'u', fetchImpl: server().fetchImpl })
    ).rejects.toMatchObject({ reason: 'no-destination' })
  })

  it('reports progress up to the advertised total', async () => {
    const { fetchImpl } = server()
    const seen = []
    await downloadInstaller({
      destinationPath: destination(),
      url: 'u',
      fetchImpl,
      onProgress: (p) => seen.push(p)
    })
    const last = seen.filter((p) => p.phase === 'download').at(-1)
    expect(last).toMatchObject({ bytesDone: PAYLOAD.length, totalBytes: PAYLOAD.length })
  })
})
