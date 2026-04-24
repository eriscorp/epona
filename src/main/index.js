import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { spawn } from 'child_process'
import { join } from 'path'
import { createSettingsManager } from './settingsManager.js'
import { launch as launchLegacy } from './targets/legacyTarget.js'
import { testConnection } from './serverTester.js'
import { listVersions, detectVersion } from './clientVersions.js'
import { launch as launchHybrasyl, resolvePath as resolveHybrasylPath } from './targets/hybrasylTarget.js'
import { launch as launchServer } from './targets/serverTarget.js'
import { listServerConfigs, readDataStore } from './serverConfigs.js'
import { checkDotnetRuntime } from './runtimeCheck.js'
import { createLineBuffer } from './lineBuffer.js'
import { listBranches, isGitRepo } from './gitOps.js'
import { releaseAll as releaseAllWorktrees } from './worktreeManager.js'

let settingsManager

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

  // File dialogs
  ipcMain.handle('dialog:openFile', async (_, title, filters) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: title || 'Select File',
      filters: filters || [{ name: 'All files', extensions: ['*'] }],
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('dialog:openDirectory', async (_, title) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: title || 'Select Directory',
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('dialog:openExe', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Dark Ages Executable',
      filters: [{ name: 'Executables', extensions: ['exe'] }],
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('dialog:openHybrasylPath', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Hybrasyl client .exe or .csproj',
      filters: [
        { name: 'Hybrasyl client (.exe or .csproj)', extensions: ['exe', 'csproj'] },
        { name: 'Executable', extensions: ['exe'] },
        { name: 'C# Project', extensions: ['csproj'] }
      ],
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('dialog:openHybrasylDataDir', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Dark Ages Data Directory',
      properties: ['openDirectory']
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

  function wireHybrasylChildLogs(child) {
    const stdout = createLineBuffer((line) =>
      mainWindow.webContents.send('hybrasyl:log', { stream: 'stdout', line })
    )
    const stderr = createLineBuffer((line) =>
      mainWindow.webContents.send('hybrasyl:log', { stream: 'stderr', line })
    )
    child.stdout?.on('data', stdout.push)
    child.stderr?.on('data', stderr.push)
    child.stdout?.on('end', stdout.flush)
    child.stderr?.on('end', stderr.flush)
    child.on('exit', (code, signal) => {
      stdout.flush()
      stderr.flush()
      if (activeHybrasylChild === child) activeHybrasylChild = null
      mainWindow.webContents.send('hybrasyl:childExit', { pid: child.pid, code, signal })
    })
    child.on('error', (err) => {
      mainWindow.webContents.send('hybrasyl:log', {
        stream: 'stderr',
        line: `[spawn error] ${err.message}`
      })
    })
  }

  ipcMain.handle('client:launch', async (_, targetKind, settings, profile) => {
    if (targetKind === 'legacy') {
      if (process.platform !== 'win32') return { success: false, error: 'Windows only' }
      return launchLegacy(settings, profile)
    }
    if (targetKind === 'hybrasyl') {
      const result = await launchHybrasyl(settings.targets.hybrasyl, profile)
      if (result.success && result.kind === 'repo' && result.child) {
        // Singleton repo run — stop the previous one so the pane shows a single
        // clean stream, then adopt the new child.
        if (activeHybrasylChild && activeHybrasylChild.exitCode === null) {
          try { activeHybrasylChild.kill() } catch { /* may already be gone */ }
        }
        activeHybrasylChild = result.child
        wireHybrasylChildLogs(result.child)
      }
      // exe launches: leave any previous child alone (multi-instance is allowed),
      // no pipes to wire. Strip the child handle from the IPC response either
      // way — it's not serialisable.
      const { child: _child, ...safe } = result
      return safe
    }
    return { success: false, error: `Unknown targetKind: ${targetKind}` }
  })
  ipcMain.handle('client:testConnection', async (_, hostname, port, version) =>
    testConnection(hostname, port, version)
  )

  // Server instance lifecycle — tracks one entry per running instanceId.
  // Each entry is { kind, value, cleanup }:
  //   kind: 'child' (Unix piped child) or 'pid' (Windows detached console)
  //   value: ChildProcess or wrapperPid
  //   cleanup: async () => void  — releases worktrees / removes Directory.Build.props
  //                                for repo-mode instances; no-op for binary
  // Stop reaps the process tree for 'pid' entries (taskkill /F /T) THEN runs cleanup.
  const instanceChildren = new Map()

  function wireInstanceLogs(instanceId, child) {
    const stdout = createLineBuffer((line) =>
      mainWindow.webContents.send('instance:log', { instanceId, stream: 'stdout', line })
    )
    const stderr = createLineBuffer((line) =>
      mainWindow.webContents.send('instance:log', { instanceId, stream: 'stderr', line })
    )
    child.stdout?.on('data', stdout.push)
    child.stderr?.on('data', stderr.push)
    child.stdout?.on('end', stdout.flush)
    child.stderr?.on('end', stderr.flush)
    child.on('exit', (code, signal) => {
      stdout.flush()
      stderr.flush()
      if (instanceChildren.get(instanceId) === child) instanceChildren.delete(instanceId)
      mainWindow.webContents.send('instance:childExit', {
        instanceId,
        pid: child.pid,
        code,
        signal
      })
    })
    child.on('error', (err) => {
      mainWindow.webContents.send('instance:log', {
        instanceId,
        stream: 'stderr',
        line: `[spawn error] ${err.message}`
      })
    })
  }

  ipcMain.handle('instance:listServerConfigs', async (_, dataDir) =>
    listServerConfigs(dataDir)
  )
  ipcMain.handle('instance:readDataStore', async (_, dataDir, configFileName) =>
    readDataStore(dataDir, configFileName)
  )

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

  ipcMain.handle('instance:start', async (_, instance) => {
    if (!instance || typeof instance.id !== 'string') {
      return { success: false, error: 'invalid instance payload' }
    }
    const existing = instanceChildren.get(instance.id)
    if (existing) {
      const alive =
        existing.kind === 'child' ? existing.value.exitCode === null : true
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
      try { await tracked.cleanup() } catch (err) {
        console.warn(`instance ${instanceId} cleanup failed:`, err.message)
      }
    }

    if (tracked.kind === 'child') {
      if (tracked.value.exitCode !== null) {
        instanceChildren.delete(instanceId)
        await runCleanup()
        return { success: true, wasRunning: false }
      }
      try {
        tracked.value.kill()
        await runCleanup()
        return { success: true, wasRunning: true }
      } catch (err) {
        return { success: false, error: err.message }
      }
    }

    // PID-tracked: reap the wrapper + its server child via taskkill /T.
    // /F forces termination so Read-Host inside the wrapper can't veto it.
    const pid = tracked.value
    return await new Promise((resolve) => {
      const tk = spawn('taskkill.exe', ['/F', '/T', '/PID', String(pid)], {
        stdio: 'ignore',
        windowsHide: true
      })
      tk.once('exit', async () => {
        instanceChildren.delete(instanceId)
        mainWindow.webContents.send('instance:childExit', {
          instanceId,
          pid,
          code: null,
          signal: 'SIGKILL'
        })
        await runCleanup()
        resolve({ success: true, wasRunning: true })
      })
      tk.once('error', (err) => {
        resolve({ success: false, error: `taskkill failed: ${err.message}` })
      })
    })
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

// Best-effort sweep of every tracked git worktree on clean shutdown so a
// normal Epona quit leaves disk tidy. Force-close via Task Manager won't
// run this; the next launch's adoption path covers that case.
app.on('before-quit', async (event) => {
  if (app._eponaCleanupRan) return
  app._eponaCleanupRan = true
  event.preventDefault()
  try {
    await releaseAllWorktrees()
  } catch (err) {
    console.warn('worktree cleanup failed on quit:', err.message)
  }
  app.quit()
})
