// Renderer-side default settings — the shape the UI renders before hydration
// completes, and the base the loaded settings.json is merged over. Kept in
// src/shared so the settings store and its tests can import it without pulling
// in the renderer. (The main process keeps its own zod-validated defaults in
// src/main/schemas/settings.js.)
export const defaultSettings = {
  targetKind: 'legacy',
  clientPath: '',
  version: 'auto',
  skipIntro: true,
  multipleInstances: true,
  hideWalls: false,
  // Hook-based, 7.41 only — the UI hides it on other versions. Off by default:
  // it installs code into the client rather than poking a few bytes.
  groundItemHints: false,
  theme: 'hybrasyl',
  activeProfile: 'official',
  profiles: [
    {
      id: 'official',
      name: 'Dark Ages (Official)',
      hostname: 'da0.kru.com',
      port: 2610,
      redirect: false
    }
  ],
  targets: {
    hybrasyl: {
      mode: 'binary',
      binaryPath: '',
      clientRepoPath: '',
      clientBranch: null,
      autoSaveLogs: false
    }
  },
  instances: [],
  activeInstance: null,
  worldDirectories: [],
  activeWorldDirectory: null
}
