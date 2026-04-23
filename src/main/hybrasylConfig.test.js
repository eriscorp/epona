import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { parseLines, mergeCfg, readCfg, writeCfg } from './hybrasylConfig.js'

describe('parseLines (parity with the sibling client DarkagesCfg parser)', () => {
  it('returns empty object for empty input', () => {
    expect(parseLines([])).toEqual({})
  })

  it('parses a single key-value pair', () => {
    expect(parseLines(['LobbyHost: foo.com'])).toEqual({ lobbyhost: 'foo.com' })
  })

  it('parses multiple keys', () => {
    expect(parseLines(['LobbyHost: foo.com', 'LobbyPort: 4200', 'Speed: 100'])).toEqual({
      lobbyhost: 'foo.com',
      lobbyport: '4200',
      speed: '100'
    })
  })

  it('trims whitespace around both sides of the colon', () => {
    expect(parseLines(['  LobbyHost : foo.com  '])).toEqual({ lobbyhost: 'foo.com' })
  })

  it('is case-insensitive — keys are normalised to lowercase', () => {
    expect(parseLines(['LOBBYHOST: foo.com'])).toEqual({ lobbyhost: 'foo.com' })
  })

  it('applies last-write-wins on duplicate keys', () => {
    expect(parseLines(['LobbyHost: first.com', 'LobbyHost: second.com'])).toEqual({
      lobbyhost: 'second.com'
    })
  })

  it('ignores lines without a colon', () => {
    expect(parseLines(['LobbyHost: foo.com', 'just noise', 'LobbyPort: 4200'])).toEqual({
      lobbyhost: 'foo.com',
      lobbyport: '4200'
    })
  })

  it('preserves empty values as empty strings', () => {
    expect(parseLines(['LobbyHost:'])).toEqual({ lobbyhost: '' })
  })

  it('splits only on the first colon — value colons kept intact', () => {
    expect(parseLines(['Tel1: "Nexus","1"'])).toEqual({ tel1: '"Nexus","1"' })
  })

  it('skips blank and whitespace-only lines', () => {
    expect(parseLines(['LobbyHost: foo.com', '', '   ', 'LobbyPort: 4200'])).toEqual({
      lobbyhost: 'foo.com',
      lobbyport: '4200'
    })
  })

  it('strips a trailing \\r so CRLF-split lines parse correctly', () => {
    expect(parseLines(['LobbyHost: foo.com\r'])).toEqual({ lobbyhost: 'foo.com' })
  })
})

describe('mergeCfg', () => {
  it('produces clean key-value lines when merging into empty text', () => {
    expect(mergeCfg('', { LobbyHost: 'foo.com', LobbyPort: '2610' })).toBe(
      'LobbyHost: foo.com\nLobbyPort: 2610\n'
    )
  })

  it('appends patches that do not exist in the original', () => {
    const result = mergeCfg('Speed: 100\n', { LobbyHost: 'foo.com' })
    expect(result).toBe('Speed: 100\nLobbyHost: foo.com\n')
  })

  it('replaces an existing key in place and preserves unrelated lines', () => {
    const existing = 'Speed: 100\nLobbyHost: old.com\nVolume: 50\n'
    const result = mergeCfg(existing, { LobbyHost: 'new.com' })
    expect(result).toBe('Speed: 100\nLobbyHost: new.com\nVolume: 50\n')
  })

  it('drops duplicate occurrences of a patched key after the first replacement', () => {
    const existing = 'LobbyHost: first.com\nSpeed: 100\nLobbyHost: second.com\n'
    const result = mergeCfg(existing, { LobbyHost: 'new.com' })
    expect(result).toBe('LobbyHost: new.com\nSpeed: 100\n')
  })

  it('matches case-insensitively but writes the canonical casing supplied in patches', () => {
    const existing = 'lobbyhost: old.com\n'
    const result = mergeCfg(existing, { LobbyHost: 'new.com' })
    expect(result).toBe('LobbyHost: new.com\n')
  })

  it('preserves CRLF line endings when the input used them', () => {
    const existing = 'Speed: 100\r\nLobbyHost: old.com\r\n'
    const result = mergeCfg(existing, { LobbyHost: 'new.com' })
    expect(result).toBe('Speed: 100\r\nLobbyHost: new.com\r\n')
  })

  it('preserves lines without colons (user comments, malformed entries) verbatim', () => {
    const existing = '# some user note\nSpeed: 100\n\nLobbyHost: old.com\n'
    const result = mergeCfg(existing, { LobbyHost: 'new.com' })
    expect(result).toBe('# some user note\nSpeed: 100\n\nLobbyHost: new.com\n')
  })

  it('omits a trailing newline when the input had none', () => {
    expect(mergeCfg('Speed: 100', { LobbyHost: 'foo.com' })).toBe('Speed: 100\nLobbyHost: foo.com')
  })
})

describe('file I/O', () => {
  let dir

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'epona-hybrasylcfg-'))
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  describe('readCfg', () => {
    it('returns an empty object when Darkages.cfg does not exist', async () => {
      expect(await readCfg(dir)).toEqual({})
    })

    it('parses an existing Darkages.cfg file', async () => {
      await fs.writeFile(join(dir, 'Darkages.cfg'), 'LobbyHost: foo.com\nLobbyPort: 2610\n', 'utf-8')
      expect(await readCfg(dir)).toEqual({ lobbyhost: 'foo.com', lobbyport: '2610' })
    })
  })

  describe('writeCfg', () => {
    it('creates Darkages.cfg when none exists', async () => {
      await writeCfg(dir, { LobbyHost: 'foo.com', LobbyPort: '2610' })
      const contents = await fs.readFile(join(dir, 'Darkages.cfg'), 'utf-8')
      expect(contents).toBe('LobbyHost: foo.com\nLobbyPort: 2610\n')
    })

    it('updates an existing file without losing unrelated keys', async () => {
      await fs.writeFile(
        join(dir, 'Darkages.cfg'),
        'Speed: 100\nLobbyHost: old.com\nVolume: 50\n',
        'utf-8'
      )
      await writeCfg(dir, { LobbyHost: 'new.com' })

      const contents = await fs.readFile(join(dir, 'Darkages.cfg'), 'utf-8')
      expect(contents).toBe('Speed: 100\nLobbyHost: new.com\nVolume: 50\n')
    })

    it('propagates errors other than ENOENT when reading existing file', async () => {
      // Point at a path that's a directory instead of a file → EISDIR
      const subdir = join(dir, 'Darkages.cfg')
      await fs.mkdir(subdir)
      await expect(writeCfg(dir, { LobbyHost: 'foo.com' })).rejects.toThrow()
    })
  })
})
