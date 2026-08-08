import { app, shell, BrowserWindow, ipcMain, dialog, screen } from 'electron'
import { existsSync, mkdirSync, copyFileSync, rmSync, promises as fs } from 'fs'
import { join } from 'path'
import { createSettingsManager } from './settingsManager.js'
import { killProcessTree } from './processKill.js'
import { settingsSchema } from './schemas/settings.js'
import {
  detectRemoteSession,
  resolveGpuOverride,
  shouldDisableHardwareAcceleration,
  clampWindowSize,
  REMOTE_SESSION_CSS,
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT
} from '../shared/remoteSession.js'
import { launch as launchLegacy } from './targets/legacyTarget.js'
import { inspectAssetDir } from './daAssets.js'
import { installFromInstaller, downloadAndInstall, isCancellation } from './daInstaller/index.js'
import { installRequestSchema, downloadRequestSchema } from './schemas/installer.js'
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
import {
  releaseAll as releaseAllWorktrees,
  flushWorktrees,
  listManaged,
  removeWorktree,
  sweepOrphans
} from './worktreeManager.js'
import { collectConfiguredRepoPaths, collectReferencedBranches } from './repoRoots.js'
import { createSplashWindow } from './splash.js'
import { formatLogLines } from '../shared/logFormat.js'
import {
  initWindowSecurity,
  registerTrustedWindow,
  hardenWindow,
  guardIpc
} from './windowSecurity.js'
import {
  createInstanceManager,
  toSafeResult,
  isTrackedAlive,
  raceChildExit
} from './instanceManager.js'
import { initSessionLog, captureError } from './sessionLog.js'
import { installGlobalErrorHandlers } from './errorHandlers.js'
import { registerDiagnosticsHandlers } from './diagnostics.js'
import { registerChangelogHandlers } from './changelog.js'
import { createStatusMonitor } from './statusMonitor.js'
import { isProcessAlive } from './processAlive.js'
import { isPortInUse } from './portProbe.js'
import { findPortOwner } from './portOwner.js'

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

// Drop to software rendering in a Remote Desktop session. Like setPath above,
// this MUST happen at module load: Electron reads the flag when it spins up the
// GPU process, so calling it inside whenReady is too late and silently does
// nothing.
//
// An RDP session has no GPU, so Chromium's GPU path is overhead with no payoff —
// it rasterises in software anyway, then pays for GPU compositing and a readback
// on top. Measured on a reporter's machine: laggy window dragging and ~10% CPU
// while idle, neither reproducible on a local console session with the same
// build.
//
// Detected rather than made a setting, on purpose. See src/shared/remoteSession.js
// for why a persisted toggle cannot work this early.
const gpuOverride = resolveGpuOverride(process.env.EPONA_DISABLE_GPU)
const softwareRendering = shouldDisableHardwareAcceleration()
if (softwareRendering) {
  app.disableHardwareAcceleration()
  console.log(
    gpuOverride === null
      ? '[display] remote session detected — hardware acceleration disabled'
      : '[display] EPONA_DISABLE_GPU set — hardware acceleration disabled'
  )
} else if (gpuOverride === false && detectRemoteSession()) {
  // Say so. This is the recourse path for someone whose machine we read wrong,
  // and a silent one leaves them unable to tell the override took effect.
  console.log('[display] remote session detected, but EPONA_DISABLE_GPU=0 — acceleration left on')
}

// Single-instance lock. A second Epona shares this userData dir and fights the
// first over Chromium's cache / GPUCache / quota DB ("Unable to move the cache",
// "Could not open the quota database"). Worse for us: each process keeps its own
// instanceChildren map and worktree refcounts, so the second window shows "Start
// Server" for a server the first one is running. Bounce the second launch and
// focus the existing window instead (wired in createAndWireMainWindow).
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) app.quit()

// Report Issue / diagnostics: session logs live in a `logs/` subfolder of the local
// app-data dir (a clean "Reveal logs folder" target, separate from settings.json).
// Install the global error nets + open this run's session file at module load, before
// `whenReady`, so a startup-time main-process error is still captured.
const logsDir = join(dataDir, 'logs')
installGlobalErrorHandlers(captureError)
void initSessionLog(logsDir)

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

// The poller that keeps the renderer's view of "which servers are running"
// honest. Module-scoped so before-quit can stop it.
let statusMonitor = null

// Resolve every configured repo path to its git top level, deduped. Shared by
// the worktree maintenance handlers and the orphan sweeps.
async function configuredRepoRoots(settings) {
  const roots = new Set()
  for (const c of collectConfiguredRepoPaths(settings)) {
    const root = await gitToplevel(c).catch(() => null)
    if (root) roots.add(root)
  }
  return roots
}

// Branches the user answered "Keep" for at the branch-switch prompt. Without
// this the quit sweep would remove the very worktree they just chose to keep,
// which would make the prompt a lie. Session-scoped on purpose: the choice means
// "I'm still using this today", not "never collect it".
const keepWorktreeBranches = new Set()

// Remove managed worktrees no saved config points at any more — the branch was
// switched away from, or the instance that used it was deleted. Never forces, so
// a worktree with uncommitted work is always kept (only Flush Worktrees discards
// work, and that asks first).
//
// Runs at startup and again on quit. Startup matters most: a force-kill or crash
// skips before-quit entirely, and that's how orphans accumulate today.
async function sweepAllOrphans(reason) {
  try {
    const settings = await settingsManager.load()
    const keep = new Set([...collectReferencedBranches(settings), ...keepWorktreeBranches])
    let removed = 0
    for (const root of await configuredRepoRoots(settings)) {
      const r = await sweepOrphans(root, keep)
      removed += r.removed.length
      for (const e of r.errors) console.warn(`worktree sweep failed for ${e.path}:`, e.error)
    }
    if (removed > 0) console.log(`worktree sweep (${reason}): removed ${removed}`)
  } catch (err) {
    console.warn(`worktree sweep (${reason}) failed:`, err.message)
  }
}

function createWindow() {
  const isMac = process.platform === 'darwin'
  const mainWindow = new BrowserWindow({
    width: 480,
    height: 800,
    // A backstop, not the real guard. The window:resize handler clears both
    // limits before sizing (setMinimumSize(0, 0)), so these do not survive the
    // first resize — clampWindowSize is what actually keeps the window usable.
    // Worth setting anyway so the window cannot come up degenerate before the
    // renderer's first resize arrives.
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    // Created resizable so setContentSize takes effect cleanly when panels open
    // (a resizable:false window makes it a silent no-op). We keep it from being
    // user-resized/maximized by locking min == max on every programmatic resize
    // (see the window:resize handler) rather than toggling resizable — the
    // toggle adds/removes WS_THICKFRAME on Windows and leaves the web contents
    // offset to the right (a left-side letterbox that springs back on close).
    resizable: true,
    maximizable: false,
    show: false,
    autoHideMenuBar: true,
    // macOS keeps the frameless look but shows the native traffic-light controls
    // (hiddenInset insets them into our custom title bar); trafficLightPosition
    // centers them in the 36px-tall bar. Windows/Linux stay fully frameless and
    // use the in-app minimize/close controls in TitleBar.
    ...(isMac
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 10 } }
      : { frame: false }),
    // 256px, not the 1024px icon master. Windows takes the packaged app's icon
    // from the exe resource, so this mainly serves dev runs and Linux — but it
    // is decoded at window creation either way, and 256 is the largest size any
    // consumer of this option asks for. electron-builder still points at the
    // 1024px build/icon.png for the icons it generates at build time.
    icon: join(__dirname, '../../resources/epona-icon-256.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // The scaffold ships `sandbox: false`, which is only needed when the preload
      // requires something beyond `electron`. Ours does not (see src/preload/index.js),
      // so the renderer runs in the OS sandbox like the splash already did. Turning
      // this back off means auditing what the preload pulls in first.
      sandbox: true
    }
  })

  // Trusted before it loads: registerTrustedWindow is what lets this window's IPC
  // through guardIpc, and the guard fails closed, so registering after the load
  // would reject whatever the renderer sends during hydration.
  registerTrustedWindow(mainWindow)

  // Strip backdrop-filter in a remote session. Four of the six themes put
  // `backdropFilter: blur(2px)` on MuiPaper.root, and MuiPaper backs Card,
  // Dialog, Accordion and Menu — so most surfaces make Chromium read back what
  // is behind them and blur it on every repaint, including every frame of a
  // window drag. Free enough on a GPU; not on the CPU, which is all an RDP
  // session has.
  //
  // Injected here rather than edited into the themes: those are hand-written and
  // stay that way. This is a runtime mitigation for one environment and it
  // reverts by not being injected. dom-ready fires before first paint, so there
  // is no flash of the blurred style.
  // Keyed to the rendering decision, not to detection: the blur is expensive
  // because compositing is on the CPU, and EPONA_DISABLE_GPU puts it there on a
  // local machine just as surely as RDP does.
  if (softwareRendering) {
    mainWindow.webContents.on('dom-ready', () => {
      mainWindow.webContents.insertCSS(REMOTE_SESSION_CSS).catch((err) => {
        console.warn('[display] remote-session CSS injection failed:', err.message)
      })
    })
  }

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

  // Child windows denied, navigation away from our own bundle denied, and any
  // http(s)/mailto URL from either handed to the OS browser instead. The policy
  // lives in windowSecurity.js so it is stated once rather than per window.
  hardenWindow(mainWindow, { allowExternal: true, openExternal: (url) => shell.openExternal(url) })

  return mainWindow
}

app.whenReady().then(() => {
  // Lost the single-instance race — app.quit() is already queued. Do no setup:
  // creating windows or the settings manager here would race the first instance
  // on the same userData dir, which is exactly what the lock prevents.
  if (!gotSingleInstanceLock) return

  // Record the renderer locations we trust, BEFORE any window loads. The IPC
  // guard fails closed against this list, so an empty list rejects everything —
  // which is the safe direction, but it means this call is load-bearing.
  initWindowSecurity(
    app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'],
    join(__dirname, '../renderer/index.html')
  )

  // Every handler below registers through `ipc`, never the raw `ipcMain`, so the
  // sender check applies by construction rather than by each handler remembering
  // to ask for it. A new handler added on the raw import silently opts out — that
  // is the one way to get this wrong, so keep the import unused past this point.
  const ipc = guardIpc(ipcMain)

  // userData is already pinned to Local at module load (see dataDir above).
  removeStrayRoamingData()
  migrateSettingsFromRoaming(dataDir)
  settingsManager = createSettingsManager(dataDir)

  if (process.platform === 'win32') {
    // Must equal electron-builder.yml's `appId`. The NSIS installer registers
    // the Start-menu/taskbar shortcut under appId; a window advertising a
    // different AppUserModelID can't be matched to it, so Windows falls back to
    // the generic Electron icon and the name "Electron" in the taskbar and its
    // jump list.
    app.setAppUserModelId(app.isPackaged ? 'co.eris.epona' : process.execPath)
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

    // The splash is alwaysOnTop + skipTaskbar. If the main window dies before
    // the reveal (a renderer crash, a close during boot), the splash outlives it
    // as a floating window the user can't focus, close, or find in the taskbar —
    // and it keeps 'window-all-closed' from firing, so the app never quits.
    mainWindow.on('closed', () => {
      if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy()
      splashWindow = null
    })
  }

  // A second launch bounced by the single-instance lock — surface the window we
  // already have. Registered here because mainWindow is function-scoped and gets
  // reassigned by the macOS 'activate' path.
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

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
  ipc.on('app:ready', revealMainWindow)
  setTimeout(revealMainWindow, 15000)

  createAndWireMainWindow()

  // Clear worktrees no config references any more, before any launch can take a
  // refcount on one. Fire-and-forget: this is housekeeping, not a boot step.
  void sweepAllOrphans('startup')

  // Settings
  ipc.handle('settings:load', () => settingsManager.load())
  ipc.handle('settings:save', (_, settings) => {
    const parsed = settingsSchema.parse(settings)
    return settingsManager.save(parsed)
  })

  // Client versions
  ipc.handle('versions:list', () => listVersions())
  ipc.handle('app:getVersion', () => app.getVersion())
  ipc.handle('client:detectVersion', async (_, exePath) => detectVersion(exePath))

  // App / diagnostics (About card). Reveal opens the app-owned settings folder;
  // registerDiagnosticsHandlers wires the Report Issue flow + reveal-logs;
  // registerChangelogHandlers backs the What's New dialog.
  ipc.handle('app:revealSettings', () => shell.openPath(dataDir))
  registerDiagnosticsHandlers(ipc, () => app.getVersion())
  registerChangelogHandlers(ipc)

  // File dialogs. Each accepts an optional defaultPath so callers can pre-fill
  // the picker with the current setting value — without it Electron's dialog
  // remembers the last directory globally per-window, which leaks state across
  // unrelated pickers (e.g. picking a server binary biases the next client
  // pick). Empty/missing defaultPath falls back to the OS default.
  function dialogDefault(p) {
    return typeof p === 'string' && p.length > 0 ? p : undefined
  }

  ipc.handle('dialog:openFile', async (_, title, filters, defaultPath) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: title || 'Select File',
      filters: filters || [{ name: 'All files', extensions: ['*'] }],
      defaultPath: dialogDefault(defaultPath),
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipc.handle('dialog:openDirectory', async (_, title, defaultPath, message) => {
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
  ipc.handle('dialog:openExe', async (_, defaultPath) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Dark Ages Executable',
      filters: [{ name: 'Executables', extensions: ['exe'] }],
      defaultPath: dialogDefault(defaultPath),
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // Hybrasyl client validation
  ipc.handle('hybrasyl:detectPath', async (_, path) => resolveHybrasylPath(path))
  ipc.handle('hybrasyl:checkRuntime', async () => checkDotnetRuntime())

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
  ipc.handle('log:save', async (_, payload) => {
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

  ipc.handle('client:launch', async (_, targetKind, _renderSettings, profile) => {
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
  ipc.handle('client:testConnection', async (_, hostname, port, version) =>
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
    // safeSend, not a raw webContents.send: the status monitor can reap a dead
    // wrapper while the window is being torn down.
    safeSend('instance:childExit', {
      instanceId,
      pid,
      code: null,
      signal: 'SIGKILL'
    })
  }

  // Drop a PID-tracked instance from tracking and tell the renderer it exited.
  //
  // This is docs/plans/complete/efficiency-review-2026-07-12.md M1, and it is
  // deliberately NOT the
  // `reapPidInstance(instanceId, pid)` that finding proposed. That shape would
  // own the kill as well, and the kill is the one thing `instance:stop` and
  // `instance:reset` genuinely disagree about:
  //
  //   stop  — a failed kill is fatal. It returns an error and leaves the instance
  //           TRACKED, because the wrapper is still holding its ports and saying
  //           otherwise would let the next Start race it on the bind.
  //   reset — a failed kill is ignored. It untracks and relaunches regardless,
  //           because the user asked for a running server and refusing them one
  //           over a stale wrapper leaves them with nothing.
  //
  // The review skipped its own suggestion for exactly that reason ("stop vs reset
  // have genuinely different kill-failure semantics"), so a helper that swallowed
  // the difference behind a flag would reintroduce the risk it was skipped over.
  // What IS shared is the untrack-and-notify pair, and that is what this owns —
  // leaving the kill-failure decision visible at both call sites.
  //
  // `before-quit` is not a third caller, though the review lists it as a variant.
  // It only kills: the map is about to be discarded, the renderer is being torn
  // down so there is nobody to notify, and worktrees are released by
  // releaseAllWorktrees and sweepAllOrphans instead. Routing it through here would
  // add all three of those back.
  //
  // Covered by index.instanceLifecycle.test.js, which pins both sides.
  function untrackPidInstance(instanceId, pid) {
    instanceChildren.delete(instanceId)
    notifyPidExit(instanceId, pid)
  }

  ipc.handle('instance:listServerConfigs', async (_, dataDir) => listServerConfigs(dataDir))
  ipc.handle('instance:readDataStore', async (_, dataDir, configFileName) =>
    readDataStore(dataDir, configFileName)
  )
  ipc.handle('instance:isHybrasylDataDir', async (_, dataDir) => isHybrasylDataDir(dataDir))

  // Does the configured Dark Ages folder look like one? Only the Legacy tab on
  // macOS and Linux asks — on Windows clientPath is an exe and clientVersions
  // already answers a sharper question about it.
  ipc.handle('assets:inspect', async (_, dirPath) => inspectAssetDir(dirPath))

  // Installing Dark Ages on macOS and Linux — HTOO-288.
  //
  // The official installer is a Windows executable, so on these platforms it
  // cannot be run. It can still be READ: src/main/daInstaller unpacks it with
  // nothing but zlib. The Legacy tab drives this, and the folder it produces
  // becomes `clientPath` — the same setting the folder picker writes, because
  // one field with two meanings is the decision HTOO-296 already made.
  //
  // One install at a time. The controller is module-local rather than per-call so
  // `installer:cancel` has something to abort, and a second start cannot orphan
  // the first.
  let activeInstall = null

  // Where the 208 MB download is cached between attempts, so a resumed or retried
  // install does not fetch it again. Under dataDir rather than the OS temp folder
  // precisely because it must survive a reboot for resume to be worth having.
  const installerCacheDir = join(dataDir, 'installer-cache')

  ipc.handle('installer:pickInstaller', async (_, defaultPath) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select the Dark Ages installer',
      // Named .exe on every platform — it is a Windows installer being read on a
      // Mac or a Linux box, so the extension filter is about the file, not the host.
      filters: [
        { name: 'Dark Ages installer', extensions: ['exe'] },
        { name: 'All files', extensions: ['*'] }
      ],
      message: 'Pick DarkAges741single.exe, or whichever version you downloaded.',
      defaultPath: dialogDefault(defaultPath),
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipc.handle('installer:pickDestination', async (_, defaultPath) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose where to install Dark Ages',
      message: 'Epona will unpack the Dark Ages files into this folder.',
      defaultPath: dialogDefault(defaultPath),
      // createDirectory lets a user make the folder in the dialog, which is what
      // the card means by "select or create an application-appropriate destination".
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // Shared by both install routes. Reports progress to the renderer and maps a
  // thrown error onto a result object, so the renderer never has to unwrap an IPC
  // exception to find out what went wrong.
  async function runInstall(run) {
    if (activeInstall)
      return { ok: false, reason: 'busy', message: 'An install is already running' }
    const controller = new AbortController()
    activeInstall = controller
    try {
      const result = await run({
        signal: controller.signal,
        onProgress: (payload) => safeSend('installer:progress', payload)
      })
      return { ok: true, ...result }
    } catch (error) {
      if (isCancellation(error)) return { ok: false, reason: 'cancelled', message: 'Cancelled' }
      return {
        ok: false,
        reason: error?.reason ?? 'failed',
        message: error?.message ?? 'The install failed'
      }
    } finally {
      activeInstall = null
    }
  }

  ipc.handle('installer:installFromFile', async (_, payload) => {
    const parsed = installRequestSchema.safeParse(payload)
    if (!parsed.success) return { ok: false, reason: 'bad-request', message: 'Invalid request' }
    const { installerPath, destinationDir } = parsed.data
    return runInstall(({ signal, onProgress }) =>
      installFromInstaller({ installerPath, destinationDir, signal, onProgress })
    )
  })

  ipc.handle('installer:download', async (_, payload) => {
    const parsed = downloadRequestSchema.safeParse(payload)
    if (!parsed.success) return { ok: false, reason: 'bad-request', message: 'Invalid request' }
    const { destinationDir } = parsed.data
    await fs.mkdir(installerCacheDir, { recursive: true }).catch(() => {})
    return runInstall(({ signal, onProgress }) =>
      downloadAndInstall({
        cacheDir: installerCacheDir,
        destinationDir,
        signal,
        onProgress
      })
    )
  })

  ipc.handle('installer:cancel', async () => {
    if (!activeInstall) return { ok: false, reason: 'idle' }
    activeInstall.abort()
    return { ok: true }
  })

  // Open a path in the OS file explorer. Used by the LogDir quick-open button.
  // shell.openPath returns '' on success, error string on failure.
  ipc.handle('shell:openPath', async (_, path) => {
    if (typeof path !== 'string' || path.length === 0) {
      return { ok: false, error: 'no path' }
    }
    const err = await shell.openPath(path)
    return err ? { ok: false, error: err } : { ok: true }
  })

  // Git ops for the repo-mode picker — list branches in a chosen repo, and
  // an inline-validation check so the path picker can flag "not a git repo"
  // before the user tries to launch.
  ipc.handle('git:listBranches', async (_, repoPath) => {
    try {
      return { ok: true, branches: await listBranches(repoPath) }
    } catch (err) {
      return { ok: false, error: err.message, branches: [] }
    }
  })
  ipc.handle('git:isGitRepo', async (_, repoPath) => isGitRepo(repoPath))
  ipc.handle('git:diagnoseGitRepo', async (_, repoPath) => diagnoseGitRepo(repoPath))

  // Force-clear managed worktrees for every configured repo — the Settings
  // "Flush Worktrees" escape hatch for the occasional "already exists" wedge.
  // Gathers repo paths from the hybrasyl client target and every server
  // instance, resolves each to its git top level (dedup), and flushes it. The
  // renderer confirms first (this discards uncommitted work in those worktrees).
  ipc.handle('worktrees:flush', async () => {
    const settings = await settingsManager.load()
    const roots = await configuredRepoRoots(settings)
    const errors = []
    let removed = 0
    for (const root of roots) {
      const r = await flushWorktrees(root)
      removed += r.removed.length
      errors.push(...r.errors)
    }
    return { ok: errors.length === 0, repos: roots.size, removed, errors }
  })

  // Every Epona-managed worktree across the configured repos, with the facts the
  // UI needs to decide: branch, path, dirty, and whether a launch still holds it.
  // Feeds both the Settings → Maintenance list and the branch-switch prompt.
  ipc.handle('worktrees:listManaged', async () => {
    const settings = await settingsManager.load()
    const out = []
    for (const root of await configuredRepoRoots(settings)) {
      try {
        out.push(...(await listManaged(root)))
      } catch (err) {
        console.warn(`worktree listing failed for ${root}:`, err.message)
      }
    }
    return out
  })

  // Remove one managed worktree. Refuses an in-use or dirty worktree unless the
  // renderer passes force after confirming with the user.
  ipc.handle('worktrees:remove', async (_, repoPath, branch, force) => {
    if (typeof repoPath !== 'string' || typeof branch !== 'string' || !branch) {
      return { ok: false, reason: 'not-found' }
    }
    try {
      return await removeWorktree(repoPath, branch, { force: force === true })
    } catch (err) {
      return { ok: false, reason: 'git', error: err.message }
    }
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

  // Authoritative running-state. The renderer used to keep its own Set in React
  // state, which drifted whenever a console-wrapped server died on its own, or
  // outlived an Epona restart. Main now polls and pushes; the renderer only
  // renders what it's told.
  statusMonitor = createStatusMonitor({
    settingsManager,
    instanceChildren,
    isPortInUse,
    isProcessAlive,
    onStatus: (snapshot) => safeSend('instance:status', snapshot),
    // A pid entry whose process is gone: run the launch's cleanup (this is what
    // releases the git worktree when the user just closes the console window)
    // and tell the renderer the process ended.
    onReap: async (instanceId, entry) => {
      notifyPidExit(instanceId, entry.value)
      await entry.cleanup?.()
    }
  })
  statusMonitor.start()

  ipc.handle('instance:getStatus', async () => statusMonitor.refresh())

  // Stop for an instance Epona doesn't track — the status monitor adopted it
  // from its listening lobby port. We have no child and no wrapper pid, so ask
  // the OS who owns the port and reap that tree. Returns `adopted: true` so the
  // renderer can word its toast for a process it didn't start.
  async function stopAdoptedInstance(instanceId) {
    const settings = await settingsManager.load()
    const inst = settings.instances.find((i) => i.id === instanceId)
    if (!inst) return { success: true, wasRunning: false }
    if (!(await isPortInUse('127.0.0.1', inst.lobbyPort, 500))) {
      return { success: true, wasRunning: false }
    }
    const pid = await findPortOwner(inst.lobbyPort)
    if (!pid) {
      return {
        success: false,
        adopted: true,
        error:
          `Something is listening on port ${inst.lobbyPort}, but Epona couldn't find which ` +
          `process owns it. Stop it from Task Manager.`
      }
    }
    const result = await killProcessTree(pid)
    if (!result.ok) {
      return { success: false, adopted: true, error: `kill failed: ${result.error.message}` }
    }
    notifyPidExit(instanceId, pid)
    void statusMonitor?.refresh()
    return { success: true, wasRunning: true, adopted: true, pid }
  }

  ipc.handle('instance:start', async (_, supplied) => {
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
    // Untracked but its lobby port is listening: a server from an earlier Epona
    // run (or started by hand). Say so plainly — serverTarget's port preflight
    // would otherwise report a generic "port already in use, kill dotnet.exe".
    if (!existing && (await isPortInUse('127.0.0.1', instance.lobbyPort, 500))) {
      return {
        success: false,
        error:
          `This instance already appears to be running — something is listening on ` +
          `port ${instance.lobbyPort}. Epona didn't start it, so use Stop to end it first.`
      }
    }
    return spawnAndTrackInstance(instance)
  })

  ipc.handle('instance:stop', async (_, instanceId) => {
    const tracked = instanceChildren.get(instanceId)
    if (!tracked) return stopAdoptedInstance(instanceId)

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
      // Fatal here, unlike in reset — see untrackPidInstance. Staying tracked is
      // what lets a second Stop retry the same wrapper.
      return { success: false, error: `kill failed: ${result.error.message}` }
    }
    untrackPidInstance(instanceId, pid)
    await runCleanup()
    // Re-derive now rather than waiting out the poll interval, so the button
    // settles immediately after the round trip.
    void statusMonitor?.refresh()
    return { success: true, wasRunning: true }
  })

  // Reset = stop + relaunch in one IPC round-trip. Awaits process death
  // before relaunching so the new server doesn't race the old one on the
  // port bind. The renderer keeps the running flag set across the gap so
  // the UI doesn't flicker mid-restart.
  ipc.handle('instance:reset', async (_, supplied) => {
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
      // The kill result is deliberately not checked — see untrackPidInstance.
      await killProcessTree(pid)
      untrackPidInstance(instance.id, pid)
    }

    try {
      await tracked.cleanup()
    } catch (err) {
      console.warn(`instance ${instance.id} cleanup failed during reset:`, err.message)
    }

    return spawnAndTrackInstance(instance)
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
  ipc.on('window:minimize', () => mainWindow.minimize())
  ipc.on('window:close', () => mainWindow.close())
  // The renderer's last requested size, replayed when the display geometry
  // changes. Without this, a window sized against a bad work area stays wrong
  // for the rest of the session: the renderer only re-sends on a pane toggle.
  let lastRequestedSize = null

  function applyWindowSize(width, height) {
    if (typeof width !== 'number' || typeof height !== 'number') return
    if (!mainWindow || mainWindow.isDestroyed()) return
    // Resize by relocking min == max instead of toggling setResizable. The old
    // toggle added/removed WS_THICKFRAME around setContentSize on Windows, which
    // left the web contents offset to the right (a left-side letterbox that
    // sprang back when the pane closed).
    //
    // CRITICAL: setMinimumSize/setMaximumSize are WINDOW-coordinate APIs;
    // setContentSize is a CONTENT-coordinate API. They differ by the frame delta,
    // so the max must NOT be set to the requested width before sizing — it clamps
    // the window before the content can reach the target, and the viewport comes
    // back short. The old comment claimed "frame:false ⇒ window size == content
    // size"; that is false on Windows, where a resizable frameless window still
    // carries WS_THICKFRAME. On a 150%-scaled display the shortfall reached 29px:
    // the renderer laid out to its hardcoded MAIN_W of 480 inside a 451px
    // viewport, overflowing to the right.
    //
    // So: clear both limits, size the CONTENT, then read back the WINDOW size we
    // actually got and lock the limits to that. e2e/content-overflow.spec.js
    // pins this.
    //
    // Clamp to the work area of the display the window is actually on. The
    // renderer's preferred 800px height does not fit a 1920x1080 panel at 150%
    // scaling (≈662 logical px of work area), and asking for more than fits
    // leaves the OS to clamp us — after which locking min == max to the
    // requested size pins the window to a height it never got. Ask for
    // something achievable instead.
    //
    // ...but the clamp needs a FLOOR as well as a ceiling, because its result is
    // locked into both the minimum and the maximum below. A degenerate work area
    // — an RDP session whose virtual display comes up small before the client
    // negotiates the real resolution, a reconnect, a mid-session DPI change —
    // otherwise collapses `target`, and the window is then pinned to an unusable
    // size with no way back: `maximizable: false` and min == max block dragging
    // and maximising alike. Reported at ~100px wide over Remote Desktop.
    // clampWindowSize keeps the ceiling and adds the floor.
    const { workAreaSize } = screen.getDisplayMatching(mainWindow.getBounds())
    const target = clampWindowSize({ width, height, workAreaSize })
    mainWindow.setMinimumSize(0, 0)
    mainWindow.setMaximumSize(0, 0)
    mainWindow.setContentSize(target.width, target.height)
    const [w, h] = mainWindow.getSize()
    mainWindow.setMinimumSize(w, h)
    mainWindow.setMaximumSize(w, h)
  }

  ipc.on('window:resize', (_, { width, height }) => {
    if (typeof width !== 'number' || typeof height !== 'number') return
    lastRequestedSize = { width, height }
    applyWindowSize(width, height)
  })

  // Re-apply the last requested size when the display geometry changes. An RDP
  // session is the case that needs it: the virtual display can come up small
  // and be renegotiated a moment later, and reconnecting or changing DPI
  // mid-session moves it again. Without this the window keeps whatever size it
  // was locked to against the old geometry.
  //
  // Replays the size the RENDERER asked for, not the clamped result — re-running
  // the clamp against the new work area is the entire point.
  const onDisplayChange = () => {
    if (!lastRequestedSize) return
    applyWindowSize(lastRequestedSize.width, lastRequestedSize.height)
  }
  screen.on('display-metrics-changed', onDisplayChange)
  screen.on('display-added', onDisplayChange)
  screen.on('display-removed', onDisplayChange)
  // screen listeners outlive the window; drop them with it or a second window
  // (the activate path on macOS) accumulates another set.
  mainWindow.on('closed', () => {
    screen.removeListener('display-metrics-changed', onDisplayChange)
    screen.removeListener('display-added', onDisplayChange)
    screen.removeListener('display-removed', onDisplayChange)
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
  // The instance that lost the single-instance lock owns no children and no
  // worktree refcounts — let it exit immediately rather than preventDefault-ing
  // its own quit to run a no-op sweep.
  if (!gotSingleInstanceLock) return
  if (app._eponaCleanupRan) return
  app._eponaCleanupRan = true
  event.preventDefault()

  // Stop polling first: a tick landing mid-teardown would reap entries this
  // sweep is about to kill, and race their worktree cleanup.
  statusMonitor?.stop()

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

  // releaseAll only knows about worktrees this run refcounted. Sweep the rest —
  // ones adopted from a previous run, or left by a branch switch.
  await sweepAllOrphans('quit')

  app.quit()
})
