import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

contextBridge.exposeInMainWorld('electron', electronAPI)

contextBridge.exposeInMainWorld('sparkAPI', {
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  listVersions: () => ipcRenderer.invoke('versions:list'),
  detectVersion: (exePath) => ipcRenderer.invoke('client:detectVersion', exePath),
  openExeDialog: () => ipcRenderer.invoke('dialog:openExe'),
  launch: (settings, profile) => ipcRenderer.invoke('client:launch', settings, profile),
  testConnection: (hostname, port, version) =>
    ipcRenderer.invoke('client:testConnection', hostname, port, version),
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  closeWindow: () => ipcRenderer.send('window:close')
})
