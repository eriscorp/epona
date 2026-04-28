import { join } from 'path'
import { promises as fs } from 'fs'
import { randomUUID } from 'crypto'

const DEFAULT_PROFILES = [
  {
    id: 'official',
    name: 'Dark Ages (Official)',
    hostname: 'da0.kru.com',
    port: 2610,
    redirect: false
  }
]

// The Hybrasyl client target mirrors the Server tab's binary/repo split.
// Binary mode points at a prebuilt client .exe; repo mode points at a .csproj
// inside a git checkout, with an optional branch that gets resolved to a git
// worktree at launch time. clientBranch === null means "use the current
// checkout in place" (no worktree).
const DEFAULT_HYBRASYL_TARGET = {
  mode: 'binary',
  binaryPath: '',
  clientRepoPath: '',
  clientBranch: null,
  showConsole: false
}

// An instance is a configured Hybrasyl server the user can start/stop from the
// Server tab. All fields are present on every instance — mode toggles which
// ones are meaningful at launch time. The world data dir is referenced by id
// into top-level `worldDirectories`, so multiple instances sharing a path only
// store it once (and editing the path updates every instance pointing at it).
export const DEFAULT_INSTANCE = {
  id: '',
  name: 'New Instance',
  mode: 'binary',
  binaryPath: '',
  serverRepoPath: '',
  serverBranch: null,
  xmlRepoPath: '',
  xmlBranch: null,
  worldDirectoryId: '',
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
  activeInstance: null,
  worldDirectories: [],
  activeWorldDirectory: null
}

function coerceInstance(raw) {
  const safe = (key, type, fallback) => (typeof raw?.[key] === type ? raw[key] : fallback)
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
    worldDirectoryId: safe('worldDirectoryId', 'string', DEFAULT_INSTANCE.worldDirectoryId),
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

// Migrate the old single-clientPath shape (clientPath + dataPath) to the
// mode-split shape (mode + binaryPath/clientRepoPath + clientBranch). Routing
// is by file extension on the old clientPath. dataPath drops entirely — the
// global Dark Ages directory is now derived from settings.clientPath.
// Idempotent: if mode is already present, leave it alone.
function migrateHybrasylClientShape(data) {
  const t = data?.targets?.hybrasyl
  if (!t || typeof t !== 'object') return data
  if (typeof t.mode === 'string') {
    // Already migrated — just sweep dropped keys in case an older Epona wrote them back.
    delete t.clientPath
    delete t.dataPath
    return data
  }
  const old = typeof t.clientPath === 'string' ? t.clientPath : ''
  if (old.toLowerCase().endsWith('.exe')) {
    t.mode = 'binary'
    t.binaryPath = old
    t.clientRepoPath = ''
    t.clientBranch = null
  } else if (old.toLowerCase().endsWith('.csproj')) {
    t.mode = 'repo'
    t.binaryPath = ''
    t.clientRepoPath = old
    t.clientBranch = null
  } else {
    t.mode = 'binary'
    t.binaryPath = ''
    t.clientRepoPath = ''
    t.clientBranch = null
  }
  delete t.clientPath
  delete t.dataPath
  return data
}

// Lower-case + forward-slash + trim trailing slashes, for dedup only. Windows
// paths are case-insensitive on disk, and users will mix `\` and `/` writing
// them by hand.
function normalizeWorldDirPath(p) {
  return p.toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '')
}

function deriveWorldDirName(p) {
  const cleaned = p.replace(/[\\/]+$/, '').replace(/\\/g, '/')
  const segs = cleaned.split('/').filter(Boolean)
  return segs[segs.length - 1] || cleaned
}

function coerceWorldDirectory(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null
  if (typeof raw.path !== 'string' || raw.path.length === 0) return null
  return {
    id: raw.id,
    name: typeof raw.name === 'string' ? raw.name : deriveWorldDirName(raw.path),
    path: raw.path
  }
}

// Migrate the legacy per-instance `dataDir` field into a top-level
// `worldDirectories` registry, with each instance carrying a `worldDirectoryId`
// reference. Idempotent: instances already migrated pass through untouched.
// Drops `dataDir` after migration — there's no "downgrade to old Epona"
// concern (single-user / pre-release).
function migrateWorldDirectories(data) {
  if (!data || typeof data !== 'object') return data

  const dirs = Array.isArray(data.worldDirectories)
    ? data.worldDirectories.map(coerceWorldDirectory).filter(Boolean)
    : []
  const byNormPath = new Map()
  for (const wd of dirs) byNormPath.set(normalizeWorldDirPath(wd.path), wd.id)

  if (Array.isArray(data.instances)) {
    for (const inst of data.instances) {
      if (!inst || typeof inst !== 'object') continue
      const hasLegacyDataDir = typeof inst.dataDir === 'string' && inst.dataDir.length > 0
      const hasId = typeof inst.worldDirectoryId === 'string' && inst.worldDirectoryId.length > 0
      if (hasLegacyDataDir && !hasId) {
        const norm = normalizeWorldDirPath(inst.dataDir)
        let id = byNormPath.get(norm)
        if (!id) {
          id = randomUUID()
          dirs.push({ id, name: deriveWorldDirName(inst.dataDir), path: inst.dataDir })
          byNormPath.set(norm, id)
        }
        inst.worldDirectoryId = id
      }
      delete inst.dataDir
    }
  }

  data.worldDirectories = dirs
  if (typeof data.activeWorldDirectory !== 'string' && dirs.length > 0) {
    data.activeWorldDirectory = dirs[0].id
  }
  return data
}

function withDefaults(data) {
  data = migrateProfiles(data)
  data = migrateHybrasylTarget(data)
  data = migrateHybrasylClientShape(data)
  data = migrateWorldDirectories(data)
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
    activeProfile:
      typeof data?.activeProfile === 'string' ? data.activeProfile : DEFAULTS.activeProfile,
    profiles:
      Array.isArray(data?.profiles) && data.profiles.length > 0 ? data.profiles : DEFAULTS.profiles,
    instances: Array.isArray(data?.instances)
      ? data.instances
          .filter((i) => i && typeof i === 'object' && typeof i.id === 'string' && i.id.length > 0)
          .map(coerceInstance)
      : [],
    activeInstance:
      typeof data?.activeInstance === 'string' ? data.activeInstance : DEFAULTS.activeInstance,
    worldDirectories: Array.isArray(data?.worldDirectories)
      ? data.worldDirectories.map(coerceWorldDirectory).filter(Boolean)
      : [],
    activeWorldDirectory:
      typeof data?.activeWorldDirectory === 'string'
        ? data.activeWorldDirectory
        : DEFAULTS.activeWorldDirectory,
    targets: {
      hybrasyl: {
        mode: data?.targets?.hybrasyl?.mode === 'repo' ? 'repo' : 'binary',
        binaryPath:
          typeof data?.targets?.hybrasyl?.binaryPath === 'string'
            ? data.targets.hybrasyl.binaryPath
            : DEFAULT_HYBRASYL_TARGET.binaryPath,
        clientRepoPath:
          typeof data?.targets?.hybrasyl?.clientRepoPath === 'string'
            ? data.targets.hybrasyl.clientRepoPath
            : DEFAULT_HYBRASYL_TARGET.clientRepoPath,
        clientBranch:
          data?.targets?.hybrasyl?.clientBranch === null
            ? null
            : typeof data?.targets?.hybrasyl?.clientBranch === 'string'
              ? data.targets.hybrasyl.clientBranch
              : DEFAULT_HYBRASYL_TARGET.clientBranch,
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

  async function doSave(data) {
    const content = JSON.stringify(data, null, 2)
    await fs.mkdir(userDataPath, { recursive: true })
    await fs.writeFile(tmp, content, 'utf-8')
    try {
      await fs.copyFile(primary, backup)
    } catch {
      /* primary may not exist yet */
    }
    await fs.rename(tmp, primary)
  }

  function save(data) {
    // .then(fn, fn) so the queue runs the next save even after a previous
    // failure — otherwise a single rejection poisons the chain and every
    // future save silently no-ops via the rejected-promise propagation.
    const op = saveQueue.then(
      () => doSave(data),
      () => doSave(data)
    )
    // Renderer's update() is fire-and-forget; without a handler here a save
    // failure surfaces as an unhandled rejection. Log so it isn't silent.
    op.catch((err) => console.error('[settings] save failed:', err))
    saveQueue = op.catch(() => {})
    return op
  }

  return { load, save }
}
