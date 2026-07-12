import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { existsSync, mkdirSync, copyFileSync, rmSync, promises as fs } from 'fs'
import { join } from 'path'
import { createSettingsManager } from './settingsManager.js'
import { killProcessTree } from './processKill.js'
import { settingsSchema } from './schemas/settings.js'
import { launch as launchLegacy } from './targets/legacyTarget.js'
import { testConnection } from './serverTester.js'
import { listVersions, detectVersion } from './clientVersions.js'
import {
  launch as launchHybrasyl,
  resolvePath as resolveHybrasylPath
} from './targets/hybrasylTarget.js'
import { launch as launchServer } from './targets/serverTarget.js'
import { listServerConfigs, readDataStore, isHybrasylDataDir } from './serverConfigs.js'
import { checkDotnetRuntime } from './runtimeCheck.js'
import { pipeChildLines } from './childLines.js'
import { listBranches, isGitRepo, diagnoseGitRepo, gitToplevel } from './gitOps.js'
import { releaseAll as releaseAllWorktrees, flushWorktrees } from './worktreeManager.js'
import { collectConfiguredRepoPaths } from './repoRoots.js'
import { createSplashWindow } from './splash.js'
import { formatLogLines } from '../shared/logFormat.js'
import {
  createInstanceManager,
  toSafeResult,
  isTrackedAlive,
  raceChildExit
} from './instanceManager.js'

let settingsManager

// Pin the app-data directory to Local BEFORE the app is ready. Electron binds
// Chromium's default session/cache to userData at the 'ready' event; if we
// override userData later (inside whenReady) Chromium has already resolved and
// begun writing to its default path — %APPDATA%\Roaming\epona on Windows — and
// its transients leak there. Computing + setPath at module load runs before
// ready, so Chromium binds to Local from the start.
//
// %LOCALAPPDATA% on Windows; the per-user app-data dir elsewhere (mac/linux have
// no roaming concept). Do NOT use app.getPath('cache') — it returns Roaming on Windows.
const localAppData =
  process.platform === 'win32'
    ? (process.env.LOCALAPPDATA ?? join(app.getPath('home'), 'AppData', 'Local'))
    : app.getPath('appData')
const dataDir = join(localAppData, 'Erisco', 'Epona')
app.setPath('userData', dataDir)

// Splash + reveal coordination. The main window is created hidden and only
// shown once the renderer signals it has hydrated its settings ('app:ready'),
// so the first visible frame is already populated (no flash of empty UI).
// splashWindow is module-scoped so createWindow's ready-to-show handler can see
// it; revealMainWindow lives inside whenReady where the mainWindow binding is.
let splashWindow = null
let mainWindowRevealed = false

// One-time migration: older Epona stored settings under the Roaming profile
// (app.getPath('appData')). We now use Local. On first launch after the switch,
// copy an existing Roaming settings.json (and its backup) into the Local dir so
// returning users keep their config. No-op on macOS/Linux (old === new dir).
function migrateSettingsFromRoaming(settingsPath) {
  try {
    const oldDir = join(app.getPath('appData'), 'Erisco', 'Epona')
    if (oldDir === settingsPath) return // same location (non-Windows) — no-op
    const newPrimary = join(settingsPath, 'settings.json')
    if (existsSync(newPrimary)) return // already migrated / fresh local settings
    const oldPrimary = join(oldDir, 'settings.json')
    if (!existsSync(oldPrimary)) return // nothing to migrate
    mkdirSync(settingsPath, { recursive: true })
    copyFileSync(oldPrimary, newPrimary)
    const oldBackup = join(oldDir, 'settings.bak.json')
    if (existsSync(oldBackup)) copyFileSync(oldBackup, join(settingsPath, 'settings.bak.json'))
  } catch {
    /* best effort — settings manager falls back to defaults */
  }
}

// Pre-fix builds leaked Chromium transients to the default app-name folder
// (%APPDATA%\Roaming\epona) because userData was overridden too late. userData
// is now pinned before ready, so that folder is never written again — sweep any
// leftover from an earlier version. Scoped to that exact default path only.
function removeStrayRoamingData() {
  if (process.platform !== 'win32') return
  try {
    const stray = join(app.getPath('appData'), app.getName()) // Roaming\epona
    if (stray === app.getPath('userData')) return // safety: never delete the live dir
    rmSync(stray, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
}

// Tracked server instances. Lifted to module scope so the before-quit handler
// can iterate and kill them before sweeping worktrees — otherwise running
// servers hold the worktree dirs open and `git worktree remove` fails silently,
// orphaning directories on disk.
//
// Each entry is { kind, value, cleanup }:
//   kind:    'child' (piped child process) | 'pid' (Windows console wrapper)
//   value:   ChildProcess | wrapperPid
//   cleanup: async () => void  — releases worktrees / removes Directory.Build.props
const instanceChildren = new Map()

function createWindow() {
  const isMac = process.platform === 'darwin'
  const mainWindow = new BrowserWindow({
    width: 480,
    height: 800,
    resizable: false,
    show: false,
    autoHideMenuBar: true,
    // macOS keeps the frameless look but shows the native traffic-light controls
    // (hiddenInset insets them into our custom title bar); trafficLightPosition
    // centers them in the 36px-tall bar. Windows/Linux stay fully frameless and
    // use the in-app minimize/close controls in TitleBar.
    ...(isMac
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 10 } }
      : { frame: false }),
    icon: join(__dirname, '../../resources/epona.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('ready-to-show', () => {
    // First launch is gated on the renderer's 'app:ready' signal (revealed by
    // revealMainWindow, which also tears down the splash). Only auto-show when
    // there's no splash — e.g. a window re-created on macOS activate.
    if (!splashWindow) mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  return mainWindow
}

app.whenReady().then(() => {
  // userData is already pinned to Local at module load (see dataDir above).
  removeStrayRoamingData()
  migrateSettingsFromRoaming(dataDir)
  settingsManager = createSettingsManager(dataDir)

  if (process.platform === 'win32') {
    app.setAppUserModelId(app.isPackaged ? 'com.darkages.epona' : process.execPath)
  }

  // Single main window, but re-creatable. On macOS, closing the window doesn't
  // quit the app (see window-all-closed below) — it destroys the window while
  // the app keeps running, and re-opening via the dock fires app.on('activate').
  // Every IPC handler closes over this `mainWindow` binding, so activate must
  // reassign it; otherwise handlers keep calling methods on the destroyed
  // window and throw "Object has been destroyed" (e.g. the resize IPC that
  // fires when the Settings pane opens).
  let mainWindow

  function createAndWireMainWindow() {
    mainWindow = createWindow()

    // Confirm-on-close is per-window state — a window recreated via the dock
    // needs its own handler and a fresh closeConfirmed flag. Repo-mode launches
    // own a git worktree + dotnet child tree; bouncing them unintentionally
    // costs build/run state and can wedge worktree refcounts, so prompt first.
    // Titlebar X and Alt+F4 both fire 'close'; on confirm we re-fire close so
    // the before-quit cleanup runs on the second pass.
    let closeConfirmed = false
    mainWindow.on('close', async (event) => {
      if (closeConfirmed) return
      const repoRunning = await collectRepoRunning()
      if (repoRunning.length === 0) return
      event.preventDefault()
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Cancel', 'Quit'],
        defaultId: 0,
        cancelId: 0,
        title: 'Confirm Quit',
        message: 'Repo-mode launches are still running.',
        detail:
          repoRunning.map((r) => `• ${r}`).join('\n') +
          '\n\nQuitting will stop them and release their git worktrees.'
      })
      if (response === 1) {
        closeConfirmed = true
        mainWindow.close()
      }
    })
  }

  // Reveal the (hidden) main window and tear down the splash. Guarded so it
  // runs once, whether triggered by the renderer's 'app:ready' signal or the
  // safety timeout below.
  function revealMainWindow() {
    if (mainWindowRevealed) return
    mainWindowRevealed = true
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
    }
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy()
    splashWindow = null
  }

  // Show the splash immediately, then create the (hidden) main window. Reveal
  // on the renderer's 'app:ready' signal, with a safety timeout so a renderer
  // that throws before signalling can't leave the app permanently invisible.
  splashWindow = createSplashWindow()
  ipcMain.on('app:ready', revealMainWindow)
  setTimeout(revealMainWindow, 15000)

  createAndWireMainWindow()

  // Settings
  ipcMain.handle('settings:load', () => settingsManager.load())
  ipcMain.handle('settings:save', (_, settings) => {
    const parsed = settingsSchema.parse(settings)
    return settingsManager.save(parsed)
  })

  // Client versions
  ipcMain.handle('versions:list', () => listVersions())
  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('client:detectVersion', async (_, exePath) => detectVersion(exePath))

  // File dialogs. Each accepts an optional defaultPath so callers can pre-fill
  // the picker with the current setting value — without it Electron's dialog
  // remembers the last directory globally per-window, which leaks state across
  // unrelated pickers (e.g. picking a server binary biases the next client
  // pick). Empty/missing defaultPath falls back to the OS default.
  function dialogDefault(p) {
    return typeof p === 'string' && p.length > 0 ? p : undefined
  }

  ipcMain.handle('dialog:openFile', async (_, title, filters, defaultPath) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: title || 'Select File',
      filters: filters || [{ name: 'All files', extensions: ['*'] }],
      defaultPath: dialogDefault(defaultPath),
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('dialog:openDirectory', async (_, title, defaultPath, message) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: title || 'Select Directory',
      // macOS renders `message` prominently inside the dialog — use it to spell
      // out what the picked folder should contain. Ignored on other platforms.
      message: typeof message === 'string' && message.length > 0 ? message : undefined,
      defaultPath: dialogDefault(defaultPath),
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('dialog:openExe', async (_, defaultPath) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Dark Ages Executable',
      filters: [{ name: 'Executables', extensions: ['exe'] }],
      defaultPath: dialogDefault(defaultPath),
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // Hybrasyl client validation
  ipcMain.handle('hybrasyl:detectPath', async (_, path) => resolveHybrasylPath(path))
  ipcMain.handle('hybrasyl:checkRuntime', async () => checkDotnetRuntime())

  // Launch + test
  // Only the singleton (repo / dotnet run) child is tracked — exe launches are
  // fire-and-forget with no pipes, so multiple can run in parallel.
  let activeHybrasylChild = null
  // Pending cleanup for the active repo child (worktree release). Runs when
  // the child exits or when a fresh launch supersedes it. Awaited inline so
  // a fast Stop→Start can't race the worktree refcount.
  let activeHybrasylCleanup = async () => {}

  function wireHybrasylChildLogs(child, cleanup) {
    // Mirror what we send to the renderer into a local buffer so the auto-save
    // path on exit can dump exactly what the user saw — without an extra round
    // trip to ask the renderer for its lines.
    const captured = []
    const record = (stream) => (line) => {
      captured.push({ stream, text: line })
      safeSend('hybrasyl:log', { stream, line })
    }
    pipeChildLines(child, {
      onStdoutLine: record('stdout'),
      onStderrLine: record('stderr'),
      onExit: async (code, signal) => {
        if (activeHybrasylChild === child) {
          activeHybrasylChild = null
          activeHybrasylCleanup = async () => {}
        }
        try {
          await cleanup()
        } catch (err) {
          console.warn('hybrasyl client cleanup failed:', err.message)
        }
        // Auto-save: only fires for repo-mode launches (this is the only path
        // that reaches wireHybrasylChildLogs) when the user has opted in AND the
        // active server instance has a logDir. Failures are non-fatal — the
        // pane still has the lines for a manual save.
        try {
          const settings = await settingsManager.load()
          if (settings.targets.hybrasyl.autoSaveLogs) {
            const dest = activeInstanceLogDir(settings)
            if (dest) {
              await writeAutoSaveLog(dest, captured, child.pid)
            }
          }
        } catch (err) {
          console.warn('hybrasyl client auto-save failed:', err.message)
        }
        safeSend('hybrasyl:childExit', { pid: child.pid, code, signal })
      },
      onErrorLine: (errLine) => {
        captured.push({ stream: 'stderr', text: errLine })
        safeSend('hybrasyl:log', { stream: 'stderr', line: errLine })
      }
    })
  }

  // Resolve the active server instance's logDir, or null if no active instance
  // is set or the active one has no logDir configured. Used by the client tab's
  // auto-save feature: client logs piggyback on the server's log directory.
  function activeInstanceLogDir(settings) {
    const inst = settings.instances.find((i) => i.id === settings.activeInstance)
    if (!inst) return null
    return typeof inst.logDir === 'string' && inst.logDir.length > 0 ? inst.logDir : null
  }

  // Filesystem-safe local timestamp like 2026-04-29_153012. Used as the only
  // varying part of an auto-saved filename so concurrent launches don't clash.
  function logTimestamp(d = new Date()) {
    const pad = (n) => String(n).padStart(2, '0')
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
    )
  }

  async function writeAutoSaveLog(logDir, lines, pid) {
    await fs.mkdir(logDir, { recursive: true })
    const filename = `hybrasyl-client-${logTimestamp()}-pid${pid ?? 'na'}.log`
    const fullPath = join(logDir, filename)
    await fs.writeFile(fullPath, formatLogLines(lines), 'utf-8')
  }

  // Manual "save log" button in LogPane — renderer formats its own buffer and
  // ships the text here. We just open a save dialog and write. Returning the
  // chosen path lets the renderer surface a "saved to …" toast.
  ipcMain.handle('log:save', async (_, payload) => {
    const content = typeof payload?.content === 'string' ? payload.content : ''
    const defaultFileName =
      typeof payload?.defaultFileName === 'string' && payload.defaultFileName.length > 0
        ? payload.defaultFileName
        : `log-${logTimestamp()}.log`
    const settings = await settingsManager.load()
    const defaultDir = activeInstanceLogDir(settings)
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Log',
      defaultPath: defaultDir ? join(defaultDir, defaultFileName) : defaultFileName,
      filters: [
        { name: 'Log files', extensions: ['log'] },
        { name: 'Text files', extensions: ['txt'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    try {
      await fs.writeFile(result.filePath, content, 'utf-8')
      return { ok: true, path: result.filePath }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('client:launch', async (_, targetKind, _renderSettings, profile) => {
    // Spawn-path hardening: disk wins. The renderer's settings payload is
    // ignored so a compromised renderer can't redirect the spawn target —
    // we only execute paths the user persisted via dialog + save.
    const settings = await settingsManager.load()
    if (targetKind === 'legacy') {
      if (process.platform !== 'win32') return { success: false, error: 'Windows only' }
      return launchLegacy(settings, profile)
    }
    if (targetKind === 'hybrasyl') {
      const result = await launchHybrasyl(settings.targets.hybrasyl, profile, settings.clientPath)
      if (result.success && result.kind === 'repo' && result.child) {
        // Singleton repo run — stop the previous one so the pane shows a single
        // clean stream, then adopt the new child.
        if (activeHybrasylChild && activeHybrasylChild.exitCode === null) {
          try {
            activeHybrasylChild.kill()
          } catch {
            /* may already be gone */
          }
        }
        // Run the previous launch's cleanup before swapping, so worktree
        // refcounts settle in order.
        try {
          await activeHybrasylCleanup()
        } catch (err) {
          console.warn('hybrasyl client previous-cleanup failed:', err.message)
        }
        activeHybrasylChild = result.child
        activeHybrasylCleanup = result.cleanup ?? (async () => {})
        wireHybrasylChildLogs(result.child, activeHybrasylCleanup)
      } else if (result.success && !result.child && result.cleanup) {
        // Binary launch with a stray cleanup (shouldn't happen today, but
        // future-proof): run it now since there's no child to wait on.
        try {
          await result.cleanup()
        } catch (err) {
          console.warn('hybrasyl client cleanup failed:', err.message)
        }
      }
      // Strip non-serialisable fields from the IPC response. exe launches:
      // leave any previous child alone (multi-instance is allowed), no pipes
      // to wire.
      return toSafeResult(result)
    }
    return { success: false, error: `Unknown targetKind: ${targetKind}` }
  })
  ipcMain.handle('client:testConnection', async (_, hostname, port, version) =>
    testConnection(hostname, port, version)
  )

  // (instanceChildren is module-scoped — see top of file. Stop reaps the
  // process tree for 'pid' entries via taskkill /F /T, then runs cleanup.)

  // Wraps webContents.send so a destroyed window during before-quit doesn't
  // throw and abort the quit handler. The renderer is going away anyway.
  function safeSend(channel, payload) {
    try {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, payload)
      }
    } catch {
      /* webContents already gone */
    }
  }

  function wireInstanceLogs(instanceId, child) {
    pipeChildLines(child, {
      onStdoutLine: (line) => safeSend('instance:log', { instanceId, stream: 'stdout', line }),
      onStderrLine: (line) => safeSend('instance:log', { instanceId, stream: 'stderr', line }),
      onExit: (code, signal) => {
        if (instanceChildren.get(instanceId) === child) instanceChildren.delete(instanceId)
        safeSend('instance:childExit', { instanceId, pid: child.pid, code, signal })
      },
      onErrorLine: (line) => safeSend('instance:log', { instanceId, stream: 'stderr', line })
    })
  }

  // PID-tracked instances (the PowerShell console wrapper) have no child stream
  // to emit a natural 'exit', so stop/reset synthesize the renderer's childExit
  // after a forced kill. Same SIGKILL payload from both call sites.
  function notifyPidExit(instanceId, pid) {
    mainWindow.webContents.send('instance:childExit', {
      instanceId,
      pid,
      code: null,
      signal: 'SIGKILL'
    })
  }

  ipcMain.handle('instance:listServerConfigs', async (_, dataDir) => listServerConfigs(dataDir))
  ipcMain.handle('instance:readDataStore', async (_, dataDir, configFileName) =>
    readDataStore(dataDir, configFileName)
  )
  ipcMain.handle('instance:isHybrasylDataDir', async (_, dataDir) => isHybrasylDataDir(dataDir))

  // Open a path in the OS file explorer. Used by the LogDir quick-open button.
  // shell.openPath returns '' on success, error string on failure.
  ipcMain.handle('shell:openPath', async (_, path) => {
    if (typeof path !== 'string' || path.length === 0) {
      return { ok: false, error: 'no path' }
    }
    const err = await shell.openPath(path)
    return err ? { ok: false, error: err } : { ok: true }
  })

  // Git ops for the repo-mode picker — list branches in a chosen repo, and
  // an inline-validation check so the path picker can flag "not a git repo"
  // before the user tries to launch.
  ipcMain.handle('git:listBranches', async (_, repoPath) => {
    try {
      return { ok: true, branches: await listBranches(repoPath) }
    } catch (err) {
      return { ok: false, error: err.message, branches: [] }
    }
  })
  ipcMain.handle('git:isGitRepo', async (_, repoPath) => isGitRepo(repoPath))
  ipcMain.handle('git:diagnoseGitRepo', async (_, repoPath) => diagnoseGitRepo(repoPath))

  // Force-clear managed worktrees for every configured repo — the Settings
  // "Flush Worktrees" escape hatch for the occasional "already exists" wedge.
  // Gathers repo paths from the hybrasyl client target and every server
  // instance, resolves each to its git top level (dedup), and flushes it. The
  // renderer confirms first (this discards uncommitted work in those worktrees).
  ipcMain.handle('worktrees:flush', async () => {
    const settings = await settingsManager.load()
    const roots = new Set()
    for (const c of collectConfiguredRepoPaths(settings)) {
      const root = await gitToplevel(c).catch(() => null)
      if (root) roots.add(root)
    }
    const errors = []
    let removed = 0
    for (const root of roots) {
      const r = await flushWorktrees(root)
      removed += r.removed.length
      errors.push(...r.errors)
    }
    return { ok: errors.length === 0, repos: roots.size, removed, errors }
  })

  // Instance lifecycle helpers live in instanceManager.js (unit-tested there);
  // bind the stateful deps once. toSafeResult / isTrackedAlive / raceChildExit
  // are pure and imported directly.
  const { resolveSuppliedInstance, spawnAndTrackInstance } = createInstanceManager({
    settingsManager,
    instanceChildren,
    wireInstanceLogs,
    launchServer
  })

  ipcMain.handle('instance:start', async (_, supplied) => {
    const resolved = await resolveSuppliedInstance(supplied)
    if (resolved.error) return { success: false, error: resolved.error }
    const instance = resolved.instance
    const existing = instanceChildren.get(instance.id)
    if (existing && isTrackedAlive(existing)) {
      return {
        success: false,
        error: 'instance is already running — stop it first',
        pid: existing.kind === 'child' ? existing.value.pid : existing.value
      }
    }
    return spawnAndTrackInstance(instance)
  })

  ipcMain.handle('instance:stop', async (_, instanceId) => {
    const tracked = instanceChildren.get(instanceId)
    if (!tracked) return { success: true, wasRunning: false }

    async function runCleanup() {
      try {
        await tracked.cleanup()
      } catch (err) {
        console.warn(`instance ${instanceId} cleanup failed:`, err.message)
      }
    }

    if (tracked.kind === 'child') {
      if (tracked.value.exitCode !== null) {
        instanceChildren.delete(instanceId)
        await runCleanup()
        return { success: true, wasRunning: false }
      }
      // Await actual exit before returning so a fast Stop→Start can't see the
      // child still tracked.
      await raceChildExit(tracked.value, 5000)
      await runCleanup()
      return { success: true, wasRunning: true }
    }

    // PID-tracked: reap the wrapper + its server child. On Windows that's
    // taskkill /F /T (force, with subtree); on POSIX it's SIGKILL to the
    // process group. /F forces termination so Read-Host inside the wrapper
    // can't veto it.
    const pid = tracked.value
    const result = await killProcessTree(pid)
    if (!result.ok) {
      return { success: false, error: `kill failed: ${result.error.message}` }
    }
    instanceChildren.delete(instanceId)
    notifyPidExit(instanceId, pid)
    await runCleanup()
    return { success: true, wasRunning: true }
  })

  // Reset = stop + relaunch in one IPC round-trip. Awaits process death
  // before relaunching so the new server doesn't race the old one on the
  // port bind. The renderer keeps the running flag set across the gap so
  // the UI doesn't flicker mid-restart.
  ipcMain.handle('instance:reset', async (_, supplied) => {
    // Same disk-wins resolution as instance:start.
    const resolved = await resolveSuppliedInstance(supplied)
    if (resolved.error) return { success: false, error: resolved.error }
    const instance = resolved.instance
    const tracked = instanceChildren.get(instance.id)
    if (!tracked) return { success: false, error: 'instance is not running' }

    if (tracked.kind === 'child') {
      // Cap so a stuck process can't deadlock the UI.
      if (tracked.value.exitCode === null) await raceChildExit(tracked.value, 5000)
    } else {
      const pid = tracked.value
      await killProcessTree(pid)
      instanceChildren.delete(instance.id)
      notifyPidExit(instance.id, pid)
    }

    try {
      await tracked.cleanup()
    } catch (err) {
      console.warn(`instance ${instance.id} cleanup failed during reset:`, err.message)
    }

    return spawnAndTrackInstance(instance)
  })

  ipcMain.handle('instance:listRunning', async () => {
    const running = []
    for (const [id, tracked] of instanceChildren) {
      if (!isTrackedAlive(tracked)) continue
      const pid = tracked.kind === 'child' ? tracked.value.pid : tracked.value
      running.push({ instanceId: id, pid })
    }
    return running
  })

  // Collect human-readable labels for any repo-mode launches still running, so
  // the close handler (in createAndWireMainWindow) can list them in the quit
  // confirmation. Binary launches are detached and self-managed — not listed.
  async function collectRepoRunning() {
    const result = []
    if (activeHybrasylChild && activeHybrasylChild.exitCode === null) {
      result.push('Hybrasyl client (repo mode)')
    }
    try {
      const settings = await settingsManager.load()
      for (const [id, tracked] of instanceChildren) {
        const inst = settings.instances.find((i) => i.id === id)
        if (!inst || inst.mode !== 'repo') continue
        if (isTrackedAlive(tracked)) result.push(`Server "${inst.name}" (repo mode)`)
      }
    } catch (err) {
      console.warn('quit-confirm settings load failed:', err.message)
    }
    return result
  }

  // Window controls
  ipcMain.on('window:minimize', () => mainWindow.minimize())
  ipcMain.on('window:close', () => mainWindow.close())
  ipcMain.on('window:resize', (_, { width, height }) => {
    if (typeof width !== 'number' || typeof height !== 'number') return
    // On Windows, `resizable: false` strips the thick frame style and makes
    // programmatic resizing a silent no-op — flip it around the call so the
    // panel toggle actually takes. setContentSize so the target matches what
    // the renderer sees (we're frame:false today, but belt-and-braces).
    const wasResizable = mainWindow.isResizable()
    mainWindow.setResizable(true)
    mainWindow.setContentSize(width, height, false)
    mainWindow.setResizable(wasResizable)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createAndWireMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Best-effort cleanup on clean shutdown. Order matters: kill any tracked
// server instances first so they release their open file handles inside the
// worktree dirs, otherwise `git worktree remove` fails silently and orphans
// directories on disk. Force-close via Task Manager won't run this; the next
// launch's adoption path covers that case.
app.on('before-quit', async (event) => {
  if (app._eponaCleanupRan) return
  app._eponaCleanupRan = true
  event.preventDefault()

  for (const [id, tracked] of instanceChildren) {
    try {
      if (tracked.kind === 'child') {
        if (tracked.value.exitCode === null) await raceChildExit(tracked.value, 2000)
      } else {
        // PID-tracked: kill the wrapper + its tree (taskkill on Windows,
        // SIGKILL to the process group on POSIX).
        await killProcessTree(tracked.value)
      }
    } catch (err) {
      console.warn(`instance ${id} kill on quit failed:`, err.message)
    }
  }

  try {
    await releaseAllWorktrees()
  } catch (err) {
    console.warn('worktree cleanup failed on quit:', err.message)
  }
  app.quit()
})
