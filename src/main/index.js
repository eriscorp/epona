import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { createSettingsManager } from './settingsManager.js'
import { launch } from './launcher.js'
import { testConnection } from './serverTester.js'
import { listVersions, detectVersion } from './clientVersions.js'
import { launch as launchChaos, resolvePath as resolveChaosPath } from './targets/chaosLauncher.js'
import { checkDotnetRuntime } from './runtimeCheck.js'

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
  ipcMain.handle('dialog:openChaosPath', async () => {
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
  ipcMain.handle('dialog:openChaosDataDir', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Dark Ages Data Directory',
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // Chaos validation
  ipcMain.handle('chaos:detectPath', async (_, path) => resolveChaosPath(path))
  ipcMain.handle('chaos:checkRuntime', async () => checkDotnetRuntime())

  // Launch + test
  ipcMain.handle('client:launch', async (_, targetKind, settings, profile) => {
    if (targetKind === 'legacy') {
      if (process.platform !== 'win32') return { success: false, error: 'Windows only' }
      return launch(settings, profile)
    }
    if (targetKind === 'chaos') {
      return launchChaos(settings.targets.chaos, profile)
    }
    return { success: false, error: `Unknown targetKind: ${targetKind}` }
  })
  ipcMain.handle('client:testConnection', async (_, hostname, port, version) =>
    testConnection(hostname, port, version)
  )

  // Window controls
  ipcMain.on('window:minimize', () => mainWindow.minimize())
  ipcMain.on('window:close', () => mainWindow.close())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
