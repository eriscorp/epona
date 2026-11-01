// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { ThemeProvider, Chip } from '@mui/material'
// Epona renders the house themes with its own text sizes (themes/eponaThemes.js).
import { themesByName } from '../themes/eponaThemes'
import { contrast } from '../lib/contrast'

const THEME_NAMES = Object.keys(themesByName)

/**
 * Epona's status chips (the .NET runtime chip, and PathPicker's chip, which
 * says whether a path was found) are filled. Outlined, their thin letters were
 * hard to read on the light themes (Sabrael's theme walk, 2026-10-31). A filled
 * chip draws `contrastText` on `main`; this renders each colour as the panels
 * do, in every theme, and measures what it draws.
 */
describe('a filled status chip', () => {
  afterEach(cleanup)

  it.each(THEME_NAMES)('%s: each status label reads on its fill', (name) => {
    const { getByTestId } = render(
      <ThemeProvider theme={themesByName[name]}>
        {['success', 'warning', 'error', 'info'].map((color) => (
          <Chip key={color} data-testid={color} size="small" color={color} label={color} />
        ))}
      </ThemeProvider>
    )
    for (const color of ['success', 'warning', 'error', 'info']) {
      const style = getComputedStyle(getByTestId(color))
      expect(
        contrast(style.color, style.backgroundColor),
        `${color}: ${style.color} on ${style.backgroundColor}`
      ).toBeGreaterThanOrEqual(4.5)
    }
  })
})
