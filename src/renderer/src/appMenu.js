import { useEffect, useRef } from 'react'
import { useMenuStore } from './store/menuStore'

/**
 * The renderer half of the macOS application menu: run a menu command, and report
 * what the menu greys out and marks. Each command runs the same action as its
 * button. See src/main/appMenu.js for the menu itself.
 *
 * `actions` are App's own handlers: `goTab` is the tab bar's change handler (it
 * also saves the target kind), `locateClient` is the toolbar's magnifier, and so
 * on. The menu adds no second way to do any of them.
 */
export function runMenuCommand(msg, actions) {
  // Nothing while a modal is open. A tab change would unmount the panel under a
  // dialog that belongs to it, and lose what was typed there. A Mac app disables
  // its menu behind a sheet the same way. The standard roles (Copy, Paste, Quit)
  // are main's and still work.
  if (isModalOpen()) return
  const command = msg?.command
  if (typeof command !== 'string') return

  if (command.startsWith('go:')) {
    actions.goTab(command.slice(3))
    return
  }
  switch (command) {
    case 'settings':
      actions.openSettings()
      return
    case 'about':
    case 'whatsNew':
      // Both dialogs belong to SettingsPane, which takes the request when it mounts.
      useMenuStore.getState().request(command)
      actions.openSettings()
      return
    case 'locateClient':
      void actions.locateClient()
      return
    case 'revealSettings':
      void actions.revealSettings()
      return
    case 'revealLogs':
      void actions.revealLogs()
      return
    case 'toggleLogPane':
      actions.toggleLogPane()
      return
    case 'recommendedInstalls':
      actions.openHelp()
      return
    case 'reportIssue':
      actions.openReportIssue()
      return
  }
}

/**
 * An open MUI `Modal`: a dialog, a menu or a popover. A closed one is unmounted,
 * or carries `MuiModal-hidden` when it is kept mounted.
 */
export function isModalOpen(doc = document) {
  return doc.querySelector('.MuiModal-root:not(.MuiModal-hidden)') !== null
}

/**
 * Wire the menu once settings have hydrated: run its commands, and report its
 * state when it changes. macOS only. Elsewhere there is no menu to drive.
 *
 * Call it once, in App, above any early `return`.
 */
export function useAppMenu(ready, state, actions) {
  const active = ready && window.sparkAPI?.platform === 'darwin'

  // Read at run time, so a command sees App's current handlers without
  // re-subscribing on every render.
  const actionsRef = useRef(actions)
  useEffect(() => {
    actionsRef.current = actions
  })

  // The command listener, once.
  useEffect(() => {
    if (!active) return
    return window.sparkAPI.onMenuCommand((msg) => runMenuCommand(msg, actionsRef.current))
  }, [active])

  // The state report, when it changes. Main compares it too, and rebuilds the
  // menu only on a real change.
  const json = JSON.stringify(state)
  useEffect(() => {
    if (!active) return
    window.sparkAPI.setMenuState(JSON.parse(json))
  }, [active, json])
}
