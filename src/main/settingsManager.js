import { join } from 'path'
import { promises as fs } from 'fs'

const DEFAULT_PROFILES = [
  {
    id: 'official',
    name: 'Dark Ages (Official)',
    hostname: 'da0.kru.com',
    port: 2610,
    redirect: false
  }
]

const DEFAULT_HYBRASYL_TARGET = {
  clientPath: '',
  dataPath: 'E:\\Games\\Dark Ages',
  showConsole: false
}

// An instance is a configured Hybrasyl server the user can start/stop from the
// Server tab. All fields are present on every instance — mode toggles which
// ones are meaningful at launch time. Repo/xml branch fields are schema-ready
// but only consumed by Stage 3.1+.
export const DEFAULT_INSTANCE = {
  id: '',
  name: 'New Instance',
  mode: 'binary',
  binaryPath: '',
  serverRepoPath: '',
  serverBranch: null,
  xmlRepoPath: '',
  xmlBranch: null,
  worldDataDir: '',
  logDir: '',
  configFileName: '',
  // Redis fields are optional per-instance OVERRIDES. When redisHost is '',
  // no HYB_REDIS_* env vars are passed and the server reads its DataStore
  // block from the selected config XML (the usual source of truth).
  redisHost: '',
  redisPort: 6379,
  redisDatabase: null,
  redisPassword: '',
  lobbyPort: 2610,
  loginPort: 2611,
  worldPort: 2612
}

const DEFAULTS = {
  targetKind: 'legacy',
  clientPath: '',
  version: 'auto',
  skipIntro: true,
  multipleInstances: true,
  hideWalls: false,
  theme: 'hybrasyl',
  activeProfile: 'official',
  profiles: DEFAULT_PROFILES,
  targets: { hybrasyl: DEFAULT_HYBRASYL_TARGET },
  instances: [],
  activeInstance: null
}

function coerceInstance(raw) {
  const safe = (key, type, fallback) =>
    typeof raw?.[key] === type ? raw[key] : fallback
  const safeNullable = (key, type, fallback) => {
    if (raw?.[key] === null) return null
    return typeof raw?.[key] === type ? raw[key] : fallback
  }
  return {
    id: safe('id', 'string', DEFAULT_INSTANCE.id),
    name: safe('name', 'string', DEFAULT_INSTANCE.name),
    mode: raw?.mode === 'repo' ? 'repo' : 'binary',
    binaryPath: safe('binaryPath', 'string', DEFAULT_INSTANCE.binaryPath),
    serverRepoPath: safe('serverRepoPath', 'string', DEFAULT_INSTANCE.serverRepoPath),
    serverBranch: safeNullable('serverBranch', 'string', DEFAULT_INSTANCE.serverBranch),
    xmlRepoPath: safe('xmlRepoPath', 'string', DEFAULT_INSTANCE.xmlRepoPath),
    xmlBranch: safeNullable('xmlBranch', 'string', DEFAULT_INSTANCE.xmlBranch),
    worldDataDir: safe('worldDataDir', 'string', DEFAULT_INSTANCE.worldDataDir),
    logDir: safe('logDir', 'string', DEFAULT_INSTANCE.logDir),
    configFileName: safe('configFileName', 'string', DEFAULT_INSTANCE.configFileName),
    redisHost: safe('redisHost', 'string', DEFAULT_INSTANCE.redisHost),
    redisPort: safe('redisPort', 'number', DEFAULT_INSTANCE.redisPort),
    redisDatabase: safeNullable('redisDatabase', 'number', DEFAULT_INSTANCE.redisDatabase),
    redisPassword: safe('redisPassword', 'string', DEFAULT_INSTANCE.redisPassword),
    lobbyPort: safe('lobbyPort', 'number', DEFAULT_INSTANCE.lobbyPort),
    loginPort: safe('loginPort', 'number', DEFAULT_INSTANCE.loginPort),
    worldPort: safe('worldPort', 'number', DEFAULT_INSTANCE.worldPort)
  }
}

function validate(data) {
  if (!data || typeof data !== 'object') return false
  return true
}

function migrateProfiles(data) {
  // Migrate from flat serverHostname/serverPort/redirectServer to profiles
  if (data && !Array.isArray(data.profiles)) {
    const profiles = [...DEFAULT_PROFILES]
    if (data.serverHostname && data.serverHostname !== 'da0.kru.com') {
      profiles.push({
        id: 'migrated',
        name: 'Custom Server',
        hostname: data.serverHostname,
        port: data.serverPort || 2610,
        redirect: true
      })
    }
    data.profiles = profiles
    data.activeProfile = data.redirectServer ? 'migrated' : 'official'
    delete data.serverHostname
    delete data.serverPort
    delete data.redirectServer
  }
  return data
}

// Rename settings.targets.chaos (stage-2 key) to settings.targets.hybrasyl.
// The downstream project is being renamed; we keep the old key readable for
// one pass, move its contents, then drop it.
function migrateHybrasylTarget(data) {
  if (data?.targets && data.targets.chaos && !data.targets.hybrasyl) {
    data.targets.hybrasyl = data.targets.chaos
    delete data.targets.chaos
  }
  return data
}

function withDefaults(data) {
  data = migrateProfiles(data)
  data = migrateHybrasylTarget(data)
  return {
    targetKind: typeof data?.targetKind === 'string' ? data.targetKind : DEFAULTS.targetKind,
    clientPath: typeof data?.clientPath === 'string' ? data.clientPath : DEFAULTS.clientPath,
    version: data?.version ?? DEFAULTS.version,
    skipIntro: typeof data?.skipIntro === 'boolean' ? data.skipIntro : DEFAULTS.skipIntro,
    multipleInstances:
      typeof data?.multipleInstances === 'boolean'
        ? data.multipleInstances
        : DEFAULTS.multipleInstances,
    hideWalls: typeof data?.hideWalls === 'boolean' ? data.hideWalls : DEFAULTS.hideWalls,
    theme: typeof data?.theme === 'string' ? data.theme : DEFAULTS.theme,
    activeProfile: typeof data?.activeProfile === 'string' ? data.activeProfile : DEFAULTS.activeProfile,
    profiles: Array.isArray(data?.profiles) && data.profiles.length > 0
      ? data.profiles
      : DEFAULTS.profiles,
    instances: Array.isArray(data?.instances)
      ? data.instances.filter((i) => i && typeof i === 'object' && typeof i.id === 'string' && i.id.length > 0).map(coerceInstance)
      : [],
    activeInstance: typeof data?.activeInstance === 'string' ? data.activeInstance : DEFAULTS.activeInstance,
    targets: {
      hybrasyl: {
        clientPath:
          typeof data?.targets?.hybrasyl?.clientPath === 'string'
            ? data.targets.hybrasyl.clientPath
            : DEFAULT_HYBRASYL_TARGET.clientPath,
        dataPath:
          typeof data?.targets?.hybrasyl?.dataPath === 'string'
            ? data.targets.hybrasyl.dataPath
            : DEFAULT_HYBRASYL_TARGET.dataPath,
        showConsole:
          typeof data?.targets?.hybrasyl?.showConsole === 'boolean'
            ? data.targets.hybrasyl.showConsole
            : DEFAULT_HYBRASYL_TARGET.showConsole
      }
    }
  }
}

async function tryReadJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!validate(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

export function createSettingsManager(userDataPath) {
  const primary = join(userDataPath, 'settings.json')
  const backup = join(userDataPath, 'settings.bak.json')
  const tmp = join(userDataPath, 'settings.tmp.json')

  async function load() {
    let data = await tryReadJson(primary)
    if (data) return withDefaults(data)

    console.warn('settings.json unreadable, trying backup')
    data = await tryReadJson(backup)
    if (data) {
      console.warn('Recovered settings from backup')
      await save(withDefaults(data))
      return withDefaults(data)
    }

    console.warn('No valid settings found, using defaults')
    return {
      ...DEFAULTS,
      profiles: [...DEFAULT_PROFILES],
      instances: [],
      targets: { hybrasyl: { ...DEFAULT_HYBRASYL_TARGET } }
    }
  }

  let saveQueue = Promise.resolve()

  function save(data) {
    saveQueue = saveQueue.then(async () => {
      const content = JSON.stringify(data, null, 2)
      await fs.mkdir(userDataPath, { recursive: true })
      await fs.writeFile(tmp, content, 'utf-8')
      try {
        await fs.copyFile(primary, backup)
      } catch {
        /* primary may not exist yet */
      }
      await fs.rename(tmp, primary)
    })
    return saveQueue
  }

  return { load, save }
}
