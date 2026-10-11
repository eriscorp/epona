// The macOS application menu. Main builds the menu. An Epona item sends its
// command to the renderer, which runs the same action as the matching button.
// Both sides read the command and tab names from here, so they cannot disagree.
//
// No imports. The menu state schema (zod) is in src/main/schemas/menuState.js and
// not here, because this directory must stay free of package imports. The
// preload cannot import this file at all (it may import only `electron`), so it
// repeats the two channel names; preload/index.test.js compares them with these.
//
// The house design is docs/architecture/macos-chrome.md in the document repo.
// Mabon is the reference implementation; creidhne is the JavaScript port this
// one follows.

/** Main → renderer: an Epona menu item was chosen. */
export const MENU_COMMAND_CHANNEL = 'menu:command'
/** Renderer → main: what the menu greys out and marks (the menu state). */
export const MENU_STATE_CHANNEL = 'app:setMenuState'

/**
 * The tabs, in order. App.jsx builds its tab bar from this list and the Go menu
 * lists the same tabs, ⌘1 to ⌘3.
 */
export const GO_TABS = [
  { tab: 'legacy', label: 'Legacy Client' },
  { tab: 'hybrasyl', label: 'Hybrasyl Client' },
  { tab: 'server', label: 'Hybrasyl Server' }
]

/**
 * What the menu greys out and marks. Main validates it (menuStateSchema).
 *
 * - `tab`: the tab on screen. The Go menu marks it.
 * - `canToggleLogPane`: the Hybrasyl Client tab is on screen in repo mode, where
 *   its console button is enabled.
 * - `logPaneOpen`: the log pane is open. The View item shows it.
 */
export const INITIAL_MENU_STATE = {
  tab: 'legacy',
  canToggleLogPane: false,
  logPaneOpen: false
}
