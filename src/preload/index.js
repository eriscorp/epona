import { contextBridge, ipcRenderer } from 'electron'

// `electron` is the ONLY module this file may require. The main window runs with
// `sandbox: true`, and a sandboxed preload gets a polyfilled loader that resolves
// `electron` and a handful of Node built-ins — nothing else. Importing any package
// here re-breaks the sandbox, and it fails at run time in the packaged app rather
// than at build time, because `externalizeDepsPlugin` leaves the bare `require` in
// the bundle for anything listed in `dependencies`.
//
// `@electron-toolkit/preload` used to be imported here to expose a `window.electron`
// bridge that nothing in the renderer ever read. Removing it is what made the
// sandbox reachable.
contextBridge.exposeInMainWorld('sparkAPI', {
  platform: process.platform,
  // Signals the main process that the renderer has hydrated its settings, so
  // the splash can be dismissed and the (already-populated) main window shown.
  appReady: () => ipcRenderer.send('app:ready'),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  listVersions: () => ipcRenderer.invoke('versions:list'),
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  // About card + Report Issue / diagnostics module. revealSettings/revealLogs open
  // the app-owned settings + logs folders; the diagnostics:* calls back the report flow.
  revealSettings: () => ipcRenderer.invoke('app:revealSettings'),
  revealLogs: () => ipcRenderer.invoke('diagnostics:revealLogs'),
  reportRendererError: (payload) => ipcRenderer.invoke('diagnostics:reportRendererError', payload),
  buildDiagnostics: () => ipcRenderer.invoke('diagnostics:build'),
  openIssue: (payload) => ipcRenderer.invoke('diagnostics:openIssue', payload),
  copyReport: (payload) => ipcRenderer.invoke('diagnostics:copyReport', payload),
  // What's New — the parsed sections of the CHANGELOG.md packaged with this build.
  readChangelog: () => ipcRenderer.invoke('changelog:read'),
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
  // Authoritative running-state, derived in main from tracked-process liveness
  // plus a lobby-port probe. getInstanceStatus() forces a fresh pass (renderer
  // mount); onInstanceStatus subscribes to the pushes that follow.
  getInstanceStatus: () => ipcRenderer.invoke('instance:getStatus'),
  onInstanceStatus: (cb) => {
    const listener = (_, payload) => cb(payload)
    ipcRenderer.on('instance:status', listener)
    return () => ipcRenderer.removeListener('instance:status', listener)
  },
  listServerConfigs: (dataDir) => ipcRenderer.invoke('instance:listServerConfigs', dataDir),
  readDataStore: (dataDir, configFileName) =>
    ipcRenderer.invoke('instance:readDataStore', dataDir, configFileName),
  listGitBranches: (repoPath) => ipcRenderer.invoke('git:listBranches', repoPath),
  isGitRepo: (repoPath) => ipcRenderer.invoke('git:isGitRepo', repoPath),
  diagnoseGitRepo: (repoPath) => ipcRenderer.invoke('git:diagnoseGitRepo', repoPath),
  flushWorktrees: () => ipcRenderer.invoke('worktrees:flush'),
  listManagedWorktrees: () => ipcRenderer.invoke('worktrees:listManaged'),
  removeWorktree: (repoPath, branch, force) =>
    ipcRenderer.invoke('worktrees:remove', repoPath, branch, force),
  isHybrasylDataDir: (dataDir) => ipcRenderer.invoke('instance:isHybrasylDataDir', dataDir),
  inspectAssetDir: (dirPath) => ipcRenderer.invoke('assets:inspect', dirPath),
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
