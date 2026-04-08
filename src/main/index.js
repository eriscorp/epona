import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { createSettingsManager } from './settingsManager.js'
import { launch } from './launcher.js'
import { testConnection } from './serverTester.js'
import { listVersions, detectVersion } from './clientVersions.js'

let settingsManager

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 480,
    height: 640,
    resizable: false,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    icon: join(__dirname, '../../resources/icon.png'),
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
  let userDataPath
  if (process.platform === 'win32') {
    userDataPath = join(app.getPath('home'), 'AppData', 'Local', 'DarkAges', 'Spark')
  } else {
    userDataPath = join(app.getPath('appData'), 'DarkAges', 'Spark')
  }
  app.setPath('userData', userDataPath)
  settingsManager = createSettingsManager(userDataPath)

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

  // File dialog
  ipcMain.handle('dialog:openExe', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Dark Ages Executable',
      filters: [{ name: 'Executables', extensions: ['exe'] }],
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // Launch + test
  ipcMain.handle('client:launch', async (_, settings) => {
    if (process.platform !== 'win32') return { success: false, error: 'Windows only' }
    return launch(settings)
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
