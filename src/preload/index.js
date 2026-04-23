import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

contextBridge.exposeInMainWorld('electron', electronAPI)

contextBridge.exposeInMainWorld('sparkAPI', {
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  listVersions: () => ipcRenderer.invoke('versions:list'),
  detectVersion: (exePath) => ipcRenderer.invoke('client:detectVersion', exePath),
  openExeDialog: () => ipcRenderer.invoke('dialog:openExe'),
  pickHybrasylPath: () => ipcRenderer.invoke('dialog:openHybrasylPath'),
  pickHybrasylDataDir: () => ipcRenderer.invoke('dialog:openHybrasylDataDir'),
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
  }
})
