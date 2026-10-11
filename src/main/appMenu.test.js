import { describe, it, expect, vi } from 'vitest'
import { buildMenuTemplate } from './appMenu.js'
import { menuStateSchema } from './schemas/menuState.js'
import { GO_TABS, INITIAL_MENU_STATE } from '../shared/appMenu.js'

// The macOS application menu. buildMenuTemplate is pure, so the whole menu is
// asserted here on any OS; e2e/app-menu.spec.js checks the installed menu on a Mac.

const build = (state = INITIAL_MENU_STATE, opts = {}) =>
  buildMenuTemplate(state, { appName: 'Epona', isDev: false, send: vi.fn(), ...opts })

/** Every item at every depth. */
function flatten(items) {
  return items.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? flatten(i.submenu) : [])])
}

const byId = (template, id) => flatten(template).find((i) => i.id === id)
const menu = (template, label) => template.find((m) => m.label === label)

describe('buildMenuTemplate', () => {
  it('has the house shape: app, File, Edit, View, Go, Window, Help', () => {
    expect(build().map((m) => m.label ?? m.role)).toEqual([
      'Epona',
      'File',
      'editMenu',
      'View',
      'Go',
      'windowMenu',
      'help'
    ])
  })

  it('has no reload, zoom or full-screen role anywhere, in any build', () => {
    // Reload drops the log panes and the running state the renderer holds. The
    // window has a fixed size laid out for 100% zoom, so zoom and full screen
    // only break the layout.
    const banned = [
      'reload',
      'forceReload',
      'forcereload',
      'zoomIn',
      'zoomOut',
      'resetZoom',
      'togglefullscreen'
    ]
    for (const isDev of [false, true]) {
      const roles = flatten(build(INITIAL_MENU_STATE, { isDev }))
        .map((i) => i.role)
        .filter(Boolean)
      expect(roles.length).toBeGreaterThan(5) // guard the guard: roles were found
      for (const role of banned) expect(roles).not.toContain(role)
    }
  })

  it('shows Toggle Developer Tools in a dev build only', () => {
    const roles = (isDev) => flatten(build(INITIAL_MENU_STATE, { isDev })).map((i) => i.role)
    expect(roles(false)).not.toContain('toggleDevTools')
    expect(roles(true)).toContain('toggleDevTools')
  })

  it('names Epona in the role labels, which would otherwise read package.json `name`', () => {
    const app = build()[0].submenu
    expect(app.find((i) => i.role === 'quit').label).toBe('Quit Epona')
    expect(app.find((i) => i.role === 'hide').label).toBe('Hide Epona')
    expect(byId(build(), 'about').label).toBe('About Epona')
    expect(byId(build(), 'settings').accelerator).toBe('Cmd+,')
  })

  it('has no Check for Updates, because there is no manual check to run', () => {
    expect(byId(build(), 'checkForUpdates')).toBeUndefined()
  })

  it('keeps the Edit menu, without which ⌘C, ⌘V and ⌘A stop working in text fields', () => {
    expect(build().some((m) => m.role === 'editMenu')).toBe(true)
  })

  it('puts Locate Assets on ⌘O and the reveal items in File', () => {
    const file = menu(build(), 'File').submenu
    expect(byId(build(), 'locateClient')).toMatchObject({
      label: 'Locate Assets…',
      accelerator: 'Cmd+O'
    })
    const ids = file.map((i) => i.id ?? i.role).filter(Boolean)
    expect(ids).toEqual(['locateClient', 'revealSettings', 'revealLogs', 'close'])
  })

  it('greys out the Log Pane item until the renderer reports it, and marks it open', () => {
    expect(byId(build(), 'toggleLogPane')).toMatchObject({ enabled: false, checked: false })
    const live = build({ ...INITIAL_MENU_STATE, canToggleLogPane: true, logPaneOpen: true })
    expect(byId(live, 'toggleLogPane')).toMatchObject({ enabled: true, checked: true })
  })

  it('lists the three tabs in order on ⌘1 to ⌘3, and marks the current one', () => {
    const t = build({ ...INITIAL_MENU_STATE, tab: 'hybrasyl' })
    const go = menu(t, 'Go').submenu
    expect(go.map((i) => i.id)).toEqual(GO_TABS.map((g) => `go:${g.tab}`))
    expect(go.map((i) => i.accelerator)).toEqual(['Cmd+1', 'Cmd+2', 'Cmd+3'])
    expect(go.filter((i) => i.checked).map((i) => i.id)).toEqual(['go:hybrasyl'])
    // No Back or Forward: Epona has no history to walk.
    expect(go).toHaveLength(3)
  })

  it('has Recommended Installs, Report an Issue and What’s New in Help', () => {
    const help = build().find((m) => m.role === 'help').submenu
    expect(help.map((i) => i.id)).toEqual(['recommendedInstalls', 'reportIssue', 'whatsNew'])
  })

  it('sends the item id as the command when an item is clicked', () => {
    const send = vi.fn()
    const t = build(INITIAL_MENU_STATE, { send })
    byId(t, 'go:server').click()
    byId(t, 'whatsNew').click()
    expect(send.mock.calls).toEqual([[{ command: 'go:server' }], [{ command: 'whatsNew' }]])
  })

  it('gives every Epona item an id, so e2e can find it', () => {
    const appItems = flatten(build()).filter((i) => typeof i.click === 'function')
    expect(appItems.length).toBe(12)
    for (const i of appItems) expect(typeof i.id).toBe('string')
  })
})

describe('menuStateSchema', () => {
  it('accepts the initial state and a live one', () => {
    expect(menuStateSchema.safeParse(INITIAL_MENU_STATE).success).toBe(true)
    const live = { tab: 'server', canToggleLogPane: true, logPaneOpen: true }
    expect(menuStateSchema.parse(live)).toEqual(live)
  })

  it.each([
    ['null', null],
    ['a missing field', { tab: 'legacy', canToggleLogPane: false }],
    ['a string for a boolean', { ...INITIAL_MENU_STATE, logPaneOpen: 'yes' }],
    ['a tab that does not exist', { ...INITIAL_MENU_STATE, tab: 'settings' }],
    ['a tab that is not a string', { ...INITIAL_MENU_STATE, tab: 2 }]
  ])('rejects %s', (_label, value) => {
    expect(menuStateSchema.safeParse(value).success).toBe(false)
  })
})
