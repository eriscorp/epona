import { describe, it, expect } from 'vitest'
import { revealFailure } from './revealFailure.js'

describe('revealFailure (HTOO-658)', () => {
  it('names the folder and the error', () => {
    expect(
      revealFailure({
        ok: false,
        path: '/home/me/.config/Erisco/Epona',
        error: 'Failed to open path'
      })
    ).toEqual({
      severity: 'error',
      message: 'Could not open the folder /home/me/.config/Erisco/Epona: Failed to open path',
      duration: 10000
    })
  })

  it('is null when the folder opened, or with no answer', () => {
    expect(revealFailure({ ok: true, path: '/x' })).toBeNull()
    expect(revealFailure(undefined)).toBeNull()
  })
})
