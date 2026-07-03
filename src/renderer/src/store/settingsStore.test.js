import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useSettings } from './settingsStore.js'
import { defaultSettings } from '../../../shared/defaultSettings.js'

function mockApi(over = {}) {
  return {
    loadSettings: vi.fn().mockResolvedValue({}),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    detectVersion: vi.fn().mockResolvedValue({ found: false }),
    listVersions: vi.fn().mockResolvedValue([]),
    ...over
  }
}

// Let queued microtasks (detectVersion/listVersions .then chains) settle.
const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('settingsStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useSettings.setState({ settings: { ...defaultSettings }, versions: [], detectedVersion: null })
    global.window = { sparkAPI: mockApi() }
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    delete global.window
  })

  describe('hydrate', () => {
    it('merges loaded settings over the defaults and returns them', async () => {
      global.window.sparkAPI = mockApi({
        loadSettings: vi.fn().mockResolvedValue({ clientPath: 'C:/da', theme: 'chadul' })
      })
      const result = await useSettings.getState().hydrate()
      expect(result.clientPath).toBe('C:/da')
      expect(result.theme).toBe('chadul')
      expect(result.targetKind).toBe('legacy') // default preserved
      expect(useSettings.getState().settings.clientPath).toBe('C:/da')
    })

    it('loads versions and probes the client version when a path is set', async () => {
      global.window.sparkAPI = mockApi({
        loadSettings: vi.fn().mockResolvedValue({ clientPath: 'C:/da' }),
        detectVersion: vi.fn().mockResolvedValue({ found: true, name: '7.41' }),
        listVersions: vi.fn().mockResolvedValue([{ name: '7.41' }])
      })
      await useSettings.getState().hydrate()
      await flush()
      expect(global.window.sparkAPI.detectVersion).toHaveBeenCalledWith('C:/da')
      expect(useSettings.getState().detectedVersion).toBe('7.41')
      expect(useSettings.getState().versions).toEqual([{ name: '7.41' }])
    })

    it('does not persist during hydration', async () => {
      await useSettings.getState().hydrate()
      vi.advanceTimersByTime(500)
      expect(global.window.sparkAPI.saveSettings).not.toHaveBeenCalled()
    })
  })

  describe('update', () => {
    it('merges the patch into settings synchronously', () => {
      useSettings.getState().update({ skipIntro: false })
      expect(useSettings.getState().settings.skipIntro).toBe(false)
    })

    it('debounces the save — a burst of edits collapses to one write of the latest', () => {
      useSettings.getState().update({ skipIntro: false })
      useSettings.getState().update({ hideWalls: true })
      useSettings.getState().update({ version: 'manual' })
      expect(global.window.sparkAPI.saveSettings).not.toHaveBeenCalled()
      vi.advanceTimersByTime(200)
      expect(global.window.sparkAPI.saveSettings).toHaveBeenCalledTimes(1)
      expect(global.window.sparkAPI.saveSettings.mock.calls[0][0]).toMatchObject({
        skipIntro: false,
        hideWalls: true,
        version: 'manual'
      })
    })

    it('re-probes the client version when clientPath changes', async () => {
      global.window.sparkAPI = mockApi({
        detectVersion: vi.fn().mockResolvedValue({ found: true, name: '7.18' })
      })
      useSettings.getState().update({ clientPath: 'D:/client' })
      await flush()
      expect(global.window.sparkAPI.detectVersion).toHaveBeenCalledWith('D:/client')
      expect(useSettings.getState().detectedVersion).toBe('7.18')
    })

    it('clears detectedVersion when clientPath is blanked', () => {
      useSettings.setState({ detectedVersion: '7.18' })
      useSettings.getState().update({ clientPath: '' })
      expect(useSettings.getState().detectedVersion).toBeNull()
    })
  })
})
