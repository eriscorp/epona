import { promises as fs } from 'fs'
import { join } from 'path'

// XSD defaults for the DataStore element (xml/src/XSD/ServerConfig.xsd:29-38).
const DATASTORE_DEFAULTS = {
  host: 'localhost',
  port: 6379,
  database: 0,
  username: '',
  password: ''
}

// Sniff a candidate XML to confirm it's actually a server config: the file
// must have at least two lines and line 2 must begin with `<ServerConfig`
// (after trimming leading whitespace). Reads the first ~2KB only — server
// configs are tiny and we only need lines 1–2 to decide.
async function isServerConfig(path) {
  let fd
  try {
    fd = await fs.open(path, 'r')
    const buf = Buffer.alloc(2048)
    const { bytesRead } = await fd.read(buf, 0, 2048, 0)
    const text = buf.subarray(0, bytesRead).toString('utf-8')
    const lines = text.split(/\r?\n/)
    return lines.length >= 2 && lines[1].trimStart().startsWith('<ServerConfig')
  } catch {
    return false
  } finally {
    if (fd) await fd.close().catch(() => {})
  }
}

// Parse the <DataStore> element out of a server config XML. Returns
// { host, port, database, username, password } with XSD defaults filling
// any unset attribute/element, or null when the file has no <DataStore>
// (server treats a missing DataStore as fatal unless CLI/env overrides
// are present — we mirror that by returning null so callers can decide).
// Regex-based parse: the element is flat, attribute-only for host/port/db,
// and stable enough that a DOMParser / fast-xml-parser dep isn't worth it.
export async function readDataStore(dataDir, configFileName) {
  if (!dataDir || !configFileName) return null
  const path = join(dataDir, 'xml', 'serverconfigs', configFileName)
  let text
  try {
    text = await fs.readFile(path, 'utf-8')
  } catch {
    return null
  }

  // Match both self-closing and container forms:
  //   <DataStore ... />
  //   <DataStore ...>...</DataStore>
  // Known fragility: this regex doesn't account for XML comments containing
  // `<DataStore` text or for CDATA sections inside the element. Hand-edited
  // configs could trip it. Adding fast-xml-parser for one element isn't worth
  // the dep cost; if the fragility ever bites, swap this for a focused parse.
  const match = text.match(/<DataStore\b([^>]*?)(\/>|>([\s\S]*?)<\/DataStore\s*>)/)
  if (!match) return null
  const attrText = match[1] ?? ''
  const innerText = match[3] ?? ''

  const attr = (name) => {
    const re = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i')
    return attrText.match(re)?.[1] ?? null
  }
  const child = (name) => {
    // Match <Name>...</Name> or self-closing <Name/>. Empty child → ''.
    const re = new RegExp(`<${name}\\s*(?:/>|>([\\s\\S]*?)<\\/${name}\\s*>)`, 'i')
    const m = innerText.match(re)
    if (!m) return null
    return (m[1] ?? '').trim()
  }

  const host = attr('Host') ?? DATASTORE_DEFAULTS.host
  const portRaw = attr('Port')
  const port =
    portRaw !== null && !Number.isNaN(Number(portRaw)) ? Number(portRaw) : DATASTORE_DEFAULTS.port
  const dbRaw = attr('Database')
  const database =
    dbRaw !== null && !Number.isNaN(Number(dbRaw)) ? Number(dbRaw) : DATASTORE_DEFAULTS.database
  const username = child('Username') ?? DATASTORE_DEFAULTS.username
  const password = child('Password') ?? DATASTORE_DEFAULTS.password

  return { host, port, database, username, password }
}

// Quick at-pick check that a chosen folder is shaped like a Hybrasyl world data
// dir. The canonical layout has <root>/xml/serverconfigs/; if that's missing,
// the user almost certainly picked the parent folder (e.g. "Hybrasyl/" instead
// of "Hybrasyl/world/"). Strictly checks the dir, not its contents.
export async function isHybrasylDataDir(dataDir) {
  if (typeof dataDir !== 'string' || dataDir.length === 0) return false
  try {
    const stat = await fs.stat(join(dataDir, 'xml', 'serverconfigs'))
    return stat.isDirectory()
  } catch {
    return false
  }
}

// List every validated server config under <dataDir>/xml/serverconfigs/
// so the UI can offer them as a dropdown. Returns an array of filenames
// (no paths), sorted alphabetically. Missing/unreadable dir → empty array;
// callers treat "no configs" the same as "wrong world data dir". Files that
// don't sniff as a ServerConfig are filtered out.
export async function listServerConfigs(dataDir) {
  if (typeof dataDir !== 'string' || dataDir.length === 0) return []
  const dir = join(dataDir, 'xml', 'serverconfigs')
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const candidates = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.xml'))
    .map((e) => e.name)
  const checks = await Promise.all(
    candidates.map(async (name) => ((await isServerConfig(join(dir, name))) ? name : null))
  )
  return checks.filter((n) => n !== null).sort()
}
