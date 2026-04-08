import { join } from 'path'
import { promises as fs } from 'fs'

const SETTINGS_FILE = 'settings.json'

const defaults = {
  clientPath: '',
  version: 'auto',
  serverHostname: 'da0.kru.com',
  serverPort: 2610,
  redirectServer: true,
  skipIntro: true,
  multipleInstances: true,
  hideWalls: false,
  theme: 'hybrasyl'
}

export function createSettingsManager(userDataPath) {
  const settingsPath = join(userDataPath, SETTINGS_FILE)

  async function ensureDir() {
    await fs.mkdir(userDataPath, { recursive: true })
  }

  async function load() {
    try {
      const raw = await fs.readFile(settingsPath, 'utf-8')
      return { ...defaults, ...JSON.parse(raw) }
    } catch {
      return { ...defaults }
    }
  }

  async function save(settings) {
    await ensureDir()
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
    return true
  }

  return { load, save }
}
