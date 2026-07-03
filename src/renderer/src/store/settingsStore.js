import { create } from 'zustand'
import { defaultSettings } from '../../../shared/defaultSettings.js'

// Persisted settings live as a single nested blob (matching how the panels
// consume `settings` + a generic `update(patch)`). Because every settings
// mutation funnels through update(), we debounce the save right there rather
// than through a store.subscribe — hydrate() writes settings without saving,
// so there's no need for elatha's suppressNextSave dance.
let saveTimer = null
function scheduleSave(settings) {
  if (saveTimer) clearTimeout(saveTimer)
  // Debounced 200ms so a flurry of edits collapses to one write; the main-side
  // save queue serializes writes and tolerates a failed one.
  saveTimer = setTimeout(() => {
    window.sparkAPI
      .saveSettings(settings)
      .catch((err) => console.error('[settings] saveSettings rejected:', err))
  }, 200)
}

// Detect the client version for a path and store it (null when absent/blank).
function detectInto(set, clientPath) {
  if (!clientPath) {
    set({ detectedVersion: null })
    return
  }
  window.sparkAPI.detectVersion(clientPath).then((result) => {
    set({ detectedVersion: result.found ? result.name : null })
  })
}

export const useSettings = create((set, get) => ({
  // Spread so the store never shares nested references with the exported
  // default (tests mutate settings freely).
  settings: { ...defaultSettings },
  versions: [],
  detectedVersion: null,

  // Load persisted settings over the defaults and kick off the client-version
  // probes. Returns the merged settings so the caller (App) can derive the
  // startup tab and fire the splash-reveal signal.
  hydrate: async () => {
    const loaded = await window.sparkAPI.loadSettings()
    set((state) => ({ settings: { ...state.settings, ...loaded } }))
    detectInto(set, get().settings.clientPath)
    window.sparkAPI.listVersions().then((versions) => set({ versions }))
    return get().settings
  },

  // Merge a patch into settings, persist (debounced), and re-probe the client
  // version when clientPath changes. The single write path for all settings.
  update: (patch) => {
    const next = { ...get().settings, ...patch }
    set({ settings: next })
    scheduleSave(next)
    if (patch.clientPath !== undefined) detectInto(set, patch.clientPath)
  }
}))
