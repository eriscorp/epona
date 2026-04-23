import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { createSettingsManager } from './settingsManager.js'
import { launch } from './launcher.js'
import { testConnection } from './serverTester.js'
import { listVersions, detectVersion } from './clientVersions.js'
import { launch as launchHybrasyl, resolvePath as resolveHybrasylPath } from './targets/hybrasylLauncher.js'
import { checkDotnetRuntime } from './runtimeCheck.js'
import { createLineBuffer } from './lineBuffer.js'

let settingsManager

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 480,
    height: 640,
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
      return launch(settings, profile)
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
