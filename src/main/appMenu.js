import { GO_TABS } from '../shared/appMenu.js'

/**
 * The macOS application menu, in place of Electron's default one. The default
 * View menu has Reload and Force Reload, which reload the renderer, and Toggle
 * Developer Tools; none of its items is an Epona command. macOS only: Windows and
 * Linux are frameless with the renderer's own buttons, and a menu there would
 * register its accelerators too.
 *
 * Pure: the template comes from the renderer's last menu state. An Epona item
 * calls `send`, and the renderer runs the same action as the matching button.
 * Standard items are Electron roles. Chromium gives a key to the page first, and
 * to the menu only when the page does not `preventDefault` it.
 *
 * Every Epona item has an `id` equal to its command, so a test (and e2e) can find
 * it with `Menu.getApplicationMenu().getMenuItemById(id)`.
 *
 * @param {typeof import('../shared/appMenu.js').INITIAL_MENU_STATE} state
 * @param {{ appName: string, isDev: boolean, send: (msg: { command: string }) => void }} options
 * @returns {import('electron').MenuItemConstructorOptions[]}
 */
export function buildMenuTemplate(state, { appName, isDev, send }) {
  const item = (label, command, extra = {}) => ({
    label,
    id: command,
    click: () => send({ command }),
    ...extra
  })
  const sep = { type: 'separator' }

  const goItems = GO_TABS.map((entry, i) =>
    item(entry.label, `go:${entry.tab}`, {
      type: 'checkbox',
      checked: state.tab === entry.tab,
      accelerator: `Cmd+${i + 1}`
    })
  )

  return [
    {
      // The role labels are set by hand. The roles read `app.name`, which comes
      // from package.json's `productName ?? name`, and Epona's package.json has
      // no productName (it is in electron-builder.yml). So a packaged build would
      // read "Quit epona".
      label: appName,
      submenu: [
        item(`About ${appName}`, 'about'),
        sep,
        item('Settings…', 'settings', { accelerator: 'Cmd+,' }),
        sep,
        { role: 'services' },
        sep,
        { role: 'hide', label: `Hide ${appName}` },
        { role: 'hideOthers' },
        { role: 'unhide' },
        sep,
        { role: 'quit', label: `Quit ${appName}` }
      ]
    },
    {
      label: 'File',
      submenu: [
        // The menu is macOS only, where the toolbar's magnifier picks the Dark
        // Ages asset folder ("Locate Assets"), not an .exe.
        item('Locate Assets…', 'locateClient', { accelerator: 'Cmd+O' }),
        sep,
        item('Reveal Settings Folder', 'revealSettings'),
        item('Reveal Logs Folder', 'revealLogs'),
        sep,
        // Epona has no tabs of its own to close, so ⌘W is the window's. On macOS
        // closing the window does not quit, and running launches keep running.
        { role: 'close' }
      ]
    },
    // Keep it: without an Edit menu, ⌘C, ⌘V and ⌘A stop working in text fields.
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        item('Log Pane', 'toggleLogPane', {
          type: 'checkbox',
          checked: state.logPaneOpen,
          enabled: state.canToggleLogPane
        }),
        // No zoom items, no full screen, no reload. The window has a fixed size
        // (min == max) laid out for 100% zoom, so zoom and full screen only break
        // the layout, and a reload drops the log panes and the running state the
        // renderer holds. (Epona does not call optimizer.watchWindowShortcuts, so
        // the zoom keys are not blocked; that is not the reason here.)
        ...(isDev ? [sep, { role: 'toggleDevTools' }] : [])
      ]
    },
    { label: 'Go', submenu: goItems },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        item('Recommended Installs…', 'recommendedInstalls'),
        item('Report an Issue…', 'reportIssue'),
        item("What's New", 'whatsNew')
      ]
    }
  ]
}
