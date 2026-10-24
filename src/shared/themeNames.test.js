import { describe, it, expect } from 'vitest'
import { THEME_NAMES, THEME_LABELS, RETIRED_THEMES, migrateThemeName } from './themeNames.js'

describe('theme names', () => {
  it('labels every theme, and no other', () => {
    expect(Object.keys(THEME_LABELS)).toEqual(THEME_NAMES)
  })

  it('maps the retired spark theme to dubhaimid (HTOO-572)', () => {
    expect(migrateThemeName('spark')).toBe('dubhaimid')
  })

  it('keeps a current theme name as it is', () => {
    for (const name of THEME_NAMES) expect(migrateThemeName(name)).toBe(name)
  })

  it('keeps an unknown name, so the renderer falls back as before', () => {
    expect(migrateThemeName('recovered')).toBe('recovered')
    expect(migrateThemeName('toString')).toBe('toString')
  })

  it('replaces a retired theme with a current one', () => {
    for (const to of Object.values(RETIRED_THEMES)) expect(THEME_NAMES).toContain(to)
    for (const from of Object.keys(RETIRED_THEMES)) expect(THEME_NAMES).not.toContain(from)
  })
})
