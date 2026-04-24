import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { listServerConfigs, readDataStore } from './serverConfigs.js'

let dir

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'epona-server-configs-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const VALID_SERVER_CONFIG = `<?xml version="1.0"?>
<ServerConfig xmlns="http://www.hybrasyl.com/XML/Hybrasyl/2020-02"/>
`

async function makeConfigs(filesOrMap) {
  const configDir = join(dir, 'xml', 'serverconfigs')
  await fs.mkdir(configDir, { recursive: true })
  // accept either ['a.xml', 'b.xml'] (all valid) or { 'a.xml': '<contents>' }
  const entries = Array.isArray(filesOrMap)
    ? filesOrMap.map((f) => [f, VALID_SERVER_CONFIG])
    : Object.entries(filesOrMap)
  for (const [name, contents] of entries) {
    await fs.writeFile(join(configDir, name), contents, 'utf-8')
  }
  return configDir
}

describe('listServerConfigs', () => {
  it('returns an empty array when dataDir is empty', async () => {
    expect(await listServerConfigs('')).toEqual([])
  })

  it('returns an empty array when the xml/serverconfigs dir does not exist', async () => {
    expect(await listServerConfigs(dir)).toEqual([])
  })

  it('lists validated .xml files alphabetically, ignoring non-xml', async () => {
    const configDir = await makeConfigs(['qa.xml', 'config.xml', 'dev.xml'])
    await fs.writeFile(join(configDir, 'readme.txt'), 'just notes', 'utf-8')
    expect(await listServerConfigs(dir)).toEqual(['config.xml', 'dev.xml', 'qa.xml'])
  })

  it('matches .xml case-insensitively', async () => {
    await makeConfigs(['Config.XML', 'dev.xml'])
    const result = await listServerConfigs(dir)
    expect(result).toContain('Config.XML')
    expect(result).toContain('dev.xml')
  })

  it('ignores subdirectories that happen to be named like .xml files', async () => {
    const configDir = await makeConfigs(['ok.xml'])
    await fs.mkdir(join(configDir, 'subdir.xml'))
    expect(await listServerConfigs(dir)).toEqual(['ok.xml'])
  })

  it('excludes .xml files whose line 2 is not a <ServerConfig> root', async () => {
    await makeConfigs({
      'config.xml': VALID_SERVER_CONFIG,
      'fragment.xml': '<?xml version="1.0"?>\n<Item name="apple"/>\n',
      'other.xml': '<?xml version="1.0"?>\n<OtherRoot/>\n'
    })
    expect(await listServerConfigs(dir)).toEqual(['config.xml'])
  })

  it('excludes single-line XMLs (no line 2 at all)', async () => {
    await makeConfigs({
      'oneliner.xml': '<?xml version="1.0"?><ServerConfig/>',
      'good.xml': VALID_SERVER_CONFIG
    })
    expect(await listServerConfigs(dir)).toEqual(['good.xml'])
  })

  it('tolerates leading whitespace before <ServerConfig on line 2', async () => {
    await makeConfigs({
      'indented.xml': '<?xml version="1.0"?>\n   <ServerConfig xmlns="..."/>\n'
    })
    expect(await listServerConfigs(dir)).toEqual(['indented.xml'])
  })

  it('reads from xml/serverconfigs, not world/xml/serverconfig', async () => {
    // Stage 3.0 originally had the wrong path — this test guards the regression.
    const wrongDir = join(dir, 'world', 'xml', 'serverconfig')
    await fs.mkdir(wrongDir, { recursive: true })
    await fs.writeFile(join(wrongDir, 'wrongplace.xml'), VALID_SERVER_CONFIG, 'utf-8')
    expect(await listServerConfigs(dir)).toEqual([])
  })
})

describe('readDataStore', () => {
  it('returns null when dataDir or configFileName is empty', async () => {
    expect(await readDataStore('', 'x.xml')).toBeNull()
    expect(await readDataStore(dir, '')).toBeNull()
  })

  it('returns null when the file does not exist', async () => {
    expect(await readDataStore(dir, 'missing.xml')).toBeNull()
  })

  it('returns null when the XML has no <DataStore> element', async () => {
    await makeConfigs({
      'x.xml': '<?xml version="1.0"?>\n<ServerConfig><Motd>Hi</Motd></ServerConfig>\n'
    })
    expect(await readDataStore(dir, 'x.xml')).toBeNull()
  })

  it('parses a full DataStore with all attributes and children', async () => {
    await makeConfigs({
      'full.xml':
        '<?xml version="1.0"?>\n<ServerConfig>\n' +
        '  <DataStore Host="10.0.0.5" Port="6380" Database="3">\n' +
        '    <Username>admin</Username>\n' +
        '    <Password>hunter2</Password>\n' +
        '  </DataStore>\n</ServerConfig>\n'
    })
    expect(await readDataStore(dir, 'full.xml')).toEqual({
      host: '10.0.0.5',
      port: 6380,
      database: 3,
      username: 'admin',
      password: 'hunter2'
    })
  })

  it('fills XSD defaults for missing attributes/children', async () => {
    // Matches the ceridwen config.xml shape: only Host set, empty username/password.
    await makeConfigs({
      'minimal.xml':
        '<?xml version="1.0"?>\n<ServerConfig>\n' +
        '  <DataStore Host="127.0.0.1"><Username /><Password /></DataStore>\n' +
        '</ServerConfig>\n'
    })
    expect(await readDataStore(dir, 'minimal.xml')).toEqual({
      host: '127.0.0.1',
      port: 6379,
      database: 0,
      username: '',
      password: ''
    })
  })

  it('handles a self-closing DataStore element', async () => {
    await makeConfigs({
      'selfclose.xml':
        '<?xml version="1.0"?>\n<ServerConfig>\n' +
        '  <DataStore Host="hosty" Port="1234" />\n</ServerConfig>\n'
    })
    expect(await readDataStore(dir, 'selfclose.xml')).toEqual({
      host: 'hosty',
      port: 1234,
      database: 0,
      username: '',
      password: ''
    })
  })

  it('falls back to XSD defaults when Port/Database are non-numeric', async () => {
    await makeConfigs({
      'badnums.xml':
        '<?xml version="1.0"?>\n<ServerConfig>\n' +
        '  <DataStore Host="h" Port="abc" Database="xyz" />\n</ServerConfig>\n'
    })
    const r = await readDataStore(dir, 'badnums.xml')
    expect(r.port).toBe(6379)
    expect(r.database).toBe(0)
  })
})
