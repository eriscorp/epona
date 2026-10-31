import { describe, it, expect, vi } from 'vitest'
import { openFolder } from './openFolder.js'

describe('openFolder (HTOO-658)', () => {
  it('reports the folder it opened', async () => {
    const shell = { openPath: vi.fn().mockResolvedValue('') }
    await expect(openFolder(shell, '/home/me/.config/Erisco/Epona')).resolves.toEqual({
      ok: true,
      path: '/home/me/.config/Erisco/Epona'
    })
  })

  it("reports shell.openPath's error with the folder, rather than dropping it", async () => {
    const shell = { openPath: vi.fn().mockResolvedValue('Failed to open path') }
    await expect(openFolder(shell, '/home/me/.config/Erisco/Epona/logs')).resolves.toEqual({
      ok: false,
      path: '/home/me/.config/Erisco/Epona/logs',
      error: 'Failed to open path'
    })
  })
})
