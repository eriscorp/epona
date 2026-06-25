import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

contextBridge.exposeInMainWorld('electron', electronAPI)

contextBridge.exposeInMainWorld('sparkAPI', {
  platform: process.platform,
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  listVersions: () => ipcRenderer.invoke('versions:list'),
  detectVersion: (exePath) => ipcRenderer.invoke('client:detectVersion', exePath),
  openExeDialog: (defaultPath) => ipcRenderer.invoke('dialog:openExe', defaultPath),
  pickFile: (title, filters, defaultPath) =>
    ipcRenderer.invoke('dialog:openFile', title, filters, defaultPath),
  pickDirectory: (title, defaultPath, message) =>
    ipcRenderer.invoke('dialog:openDirectory', title, defaultPath, message),
  detectHybrasylPath: (path) => ipcRenderer.invoke('hybrasyl:detectPath', path),
  checkDotnetRuntime: () => ipcRenderer.invoke('hybrasyl:checkRuntime'),
  launch: (targetKind, settings, profile) =>
    ipcRenderer.invoke('client:launch', targetKind, settings, profile),
  testConnection: (hostname, port, version) =>
    ipcRenderer.invoke('client:testConnection', hostname, port, version),
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  resizeWindow: (width, height) => ipcRenderer.send('window:resize', { width, height }),
  onHybrasylLog: (cb) => {
    const listener = (_, payload) => cb(payload)
    ipcRenderer.on('hybrasyl:log', listener)
    return () => ipcRenderer.removeListener('hybrasyl:log', listener)
  },
  onHybrasylChildExit: (cb) => {
    const listener = (_, payload) => cb(payload)
    ipcRenderer.on('hybrasyl:childExit', listener)
    return () => ipcRenderer.removeListener('hybrasyl:childExit', listener)
  },

  startInstance: (instance) => ipcRenderer.invoke('instance:start', instance),
  stopInstance: (instanceId) => ipcRenderer.invoke('instance:stop', instanceId),
  resetInstance: (instance) => ipcRenderer.invoke('instance:reset', instance),
  listRunningInstances: () => ipcRenderer.invoke('instance:listRunning'),
  listServerConfigs: (dataDir) => ipcRenderer.invoke('instance:listServerConfigs', dataDir),
  readDataStore: (dataDir, configFileName) =>
    ipcRenderer.invoke('instance:readDataStore', dataDir, configFileName),
  listGitBranches: (repoPath) => ipcRenderer.invoke('git:listBranches', repoPath),
  isGitRepo: (repoPath) => ipcRenderer.invoke('git:isGitRepo', repoPath),
  diagnoseGitRepo: (repoPath) => ipcRenderer.invoke('git:diagnoseGitRepo', repoPath),
  isHybrasylDataDir: (dataDir) => ipcRenderer.invoke('instance:isHybrasylDataDir', dataDir),
  openPath: (path) => ipcRenderer.invoke('shell:openPath', path),
  saveLog: (content, defaultFileName) =>
    ipcRenderer.invoke('log:save', { content, defaultFileName }),
  onInstanceLog: (cb) => {
    const listener = (_, payload) => cb(payload)
    ipcRenderer.on('instance:log', listener)
    return () => ipcRenderer.removeListener('instance:log', listener)
  },
  onInstanceChildExit: (cb) => {
    const listener = (_, payload) => cb(payload)
    ipcRenderer.on('instance:childExit', listener)
    return () => ipcRenderer.removeListener('instance:childExit', listener)
  }
})
