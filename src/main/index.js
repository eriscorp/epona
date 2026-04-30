import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { createSettingsManager } from './settingsManager.js'
import { killProcessTree } from './processKill.js'
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
import { createLineBuffer } from './lineBuffer.js'
import { listBranches, isGitRepo } from './gitOps.js'
import { releaseAll as releaseAllWorktrees } from './worktreeManager.js'

let settingsManager

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
  const mainWindow = new BrowserWindow({
    width: 480,
    height: 800,
    resizable: false,
    show: false,
    autoHideMenuBar: true,
    frame: false,
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
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  return mainWindow
}

app.whenReady().then(() => {
  // Settings in %APPDATA%/Erisco/Epona (roaming), cache in %LOCALAPPDATA%/Erisco/Epona (local)
  const settingsPath = join(app.getPath('appData'), 'Erisco', 'Epona')
  const cachePath = join(app.getPath('cache'), 'Erisco', 'Epona')
  app.setPath('userData', cachePath)
  settingsManager = createSettingsManager(settingsPath)

  if (process.platform === 'win32') {
    app.setAppUserModelId(app.isPackaged ? 'com.darkages.epona' : process.execPath)
  }

  const mainWindow = createWindow()

  // Settings
  ipcMain.handle('settings:load', () => settingsManager.load())
  ipcMain.handle('settings:save', (_, settings) => settingsManager.save(settings))

  // Client versions
  ipcMain.handle('versions:list', () => listVersions())
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
  ipcMain.handle('dialog:openDirectory', async (_, title, defaultPath) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: title || 'Select Directory',
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
    const stdout = createLineBuffer(record('stdout'))
    const stderr = createLineBuffer(record('stderr'))
    child.stdout?.on('data', stdout.push)
    child.stderr?.on('data', stderr.push)
    child.stdout?.on('end', stdout.flush)
    child.stderr?.on('end', stderr.flush)
    child.on('exit', async (code, signal) => {
      stdout.flush()
      stderr.flush()
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
    })
    child.on('error', (err) => {
      const errLine = `[spawn error] ${err.message}`
      captured.push({ stream: 'stderr', text: errLine })
      safeSend('hybrasyl:log', { stream: 'stderr', line: errLine })
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

  function formatLogLines(lines) {
    return lines
      .map(({ stream, text }) => {
        if (stream === 'stderr') return `[stderr] ${text}`
        if (stream === 'exit') return `[exit] ${text}`
        return text
      })
      .join('\n')
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
      const { child: _child, cleanup: _cleanup, ...safe } = result
      return safe
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
    const stdout = createLineBuffer((line) =>
      safeSend('instance:log', { instanceId, stream: 'stdout', line })
    )
    const stderr = createLineBuffer((line) =>
      safeSend('instance:log', { instanceId, stream: 'stderr', line })
    )
    child.stdout?.on('data', stdout.push)
    child.stderr?.on('data', stderr.push)
    child.stdout?.on('end', stdout.flush)
    child.stderr?.on('end', stderr.flush)
    child.on('exit', (code, signal) => {
      stdout.flush()
      stderr.flush()
      if (instanceChildren.get(instanceId) === child) instanceChildren.delete(instanceId)
      safeSend('instance:childExit', { instanceId, pid: child.pid, code, signal })
    })
    child.on('error', (err) => {
      safeSend('instance:log', {
        instanceId,
        stream: 'stderr',
        line: `[spawn error] ${err.message}`
      })
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

  // Resolve an instance's worldDirectoryId to a concrete dataDir path that
  // serverTarget understands. Returns null if the world directory is missing
  // (deleted out from under the instance, or never set).
  function resolveInstanceForLaunch(settings, instance) {
    const wd = settings.worldDirectories.find((w) => w.id === instance.worldDirectoryId)
    if (!wd) return null
    return { ...instance, dataDir: wd.path }
  }

  ipcMain.handle('instance:start', async (_, supplied) => {
    if (!supplied || typeof supplied.id !== 'string') {
      return { success: false, error: 'invalid instance payload' }
    }
    // Spawn-path hardening: re-resolve the instance from disk by id so the
    // renderer can't supply forged paths. Unsaved edits will fail this lookup,
    // forcing a save before launch.
    const settings = await settingsManager.load()
    const persisted = settings.instances.find((i) => i.id === supplied.id)
    if (!persisted) {
      return { success: false, error: 'instance not in saved settings — save changes first' }
    }
    const instance = resolveInstanceForLaunch(settings, persisted)
    if (!instance) {
      return {
        success: false,
        error: 'World directory not selected for this instance — pick one in settings.'
      }
    }
    const existing = instanceChildren.get(instance.id)
    if (existing) {
      const alive = existing.kind === 'child' ? existing.value.exitCode === null : true
      if (alive) {
        return {
          success: false,
          error: 'instance is already running — stop it first',
          pid: existing.kind === 'child' ? existing.value.pid : existing.value
        }
      }
    }
    const result = await launchServer(instance)
    const cleanup = result.cleanup ?? (async () => {})
    if (result.success && result.child) {
      instanceChildren.set(instance.id, { kind: 'child', value: result.child, cleanup })
      wireInstanceLogs(instance.id, result.child)
    } else if (result.success && result.pid) {
      instanceChildren.set(instance.id, { kind: 'pid', value: result.pid, cleanup })
    }
    const { child: _child, cleanup: _cleanup, ...safe } = result
    return safe
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
      // child still tracked. wireInstanceLogs handles the delete + event emit
      // when exit fires; we cap the wait so a hung child can't block the IPC.
      const exited = new Promise((resolve) => tracked.value.once('exit', resolve))
      try {
        tracked.value.kill()
      } catch {
        /* already gone */
      }
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))])
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
    mainWindow.webContents.send('instance:childExit', {
      instanceId,
      pid,
      code: null,
      signal: 'SIGKILL'
    })
    await runCleanup()
    return { success: true, wasRunning: true }
  })

  // Reset = stop + relaunch in one IPC round-trip. Awaits process death
  // before relaunching so the new server doesn't race the old one on the
  // port bind. The renderer keeps the running flag set across the gap so
  // the UI doesn't flicker mid-restart.
  ipcMain.handle('instance:reset', async (_, supplied) => {
    if (!supplied || typeof supplied.id !== 'string') {
      return { success: false, error: 'invalid instance payload' }
    }
    // Same disk-wins resolution as instance:start.
    const settings = await settingsManager.load()
    const persisted = settings.instances.find((i) => i.id === supplied.id)
    if (!persisted) {
      return { success: false, error: 'instance not in saved settings — save changes first' }
    }
    const instance = resolveInstanceForLaunch(settings, persisted)
    if (!instance) {
      return {
        success: false,
        error: 'World directory not selected for this instance — pick one in settings.'
      }
    }
    const tracked = instanceChildren.get(instance.id)
    if (!tracked) return { success: false, error: 'instance is not running' }

    if (tracked.kind === 'child') {
      if (tracked.value.exitCode === null) {
        const exited = new Promise((resolve) => tracked.value.once('exit', resolve))
        try {
          tracked.value.kill()
        } catch {
          /* already gone */
        }
        // Cap so a stuck process can't deadlock the UI.
        await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))])
      }
    } else {
      const pid = tracked.value
      await killProcessTree(pid)
      instanceChildren.delete(instance.id)
      mainWindow.webContents.send('instance:childExit', {
        instanceId: instance.id,
        pid,
        code: null,
        signal: 'SIGKILL'
      })
    }

    try {
      await tracked.cleanup()
    } catch (err) {
      console.warn(`instance ${instance.id} cleanup failed during reset:`, err.message)
    }

    const result = await launchServer(instance)
    const cleanup = result.cleanup ?? (async () => {})
    if (result.success && result.child) {
      instanceChildren.set(instance.id, { kind: 'child', value: result.child, cleanup })
      wireInstanceLogs(instance.id, result.child)
    } else if (result.success && result.pid) {
      instanceChildren.set(instance.id, { kind: 'pid', value: result.pid, cleanup })
    }
    const { child: _child, cleanup: _cleanup, ...safe } = result
    return safe
  })

  ipcMain.handle('instance:listRunning', async () => {
    const running = []
    for (const [id, tracked] of instanceChildren) {
      if (tracked.kind === 'child') {
        if (tracked.value.exitCode === null) {
          running.push({ instanceId: id, pid: tracked.value.pid })
        }
      } else {
        running.push({ instanceId: id, pid: tracked.value })
      }
    }
    return running
  })

  // Confirm before closing if any repo-mode launches are still running. Repo
  // launches own a git worktree and a dotnet child tree — bouncing them
  // unintentionally costs the user their build/run state and can leave
  // worktree refcounts stuck if cleanup races. Binary launches are detached
  // and self-managed; no prompt for those. Triggered by titlebar X and Alt+F4
  // (both fire the 'close' event); on user confirm we re-fire close so the
  // existing before-quit cleanup runs on the second pass.
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
        const alive = tracked.kind === 'child' ? tracked.value.exitCode === null : true
        if (alive) result.push(`Server "${inst.name}" (repo mode)`)
      }
    } catch (err) {
      console.warn('quit-confirm settings load failed:', err.message)
    }
    return result
  }

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
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
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
        if (tracked.value.exitCode === null) {
          const exited = new Promise((r) => tracked.value.once('exit', r))
          tracked.value.kill()
          await Promise.race([exited, new Promise((r) => setTimeout(r, 2000))])
        }
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
