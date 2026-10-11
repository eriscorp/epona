import { z } from 'zod'
import { GO_TABS } from '../../shared/appMenu.js'

// The renderer's report for the macOS application menu (app:setMenuState). It
// is fire-and-forget, so a bad report is dropped and the menu keeps the last
// good one. Here and not in src/shared/appMenu.js, because that file must not
// import a package.
export const menuStateSchema = z.object({
  tab: z.enum(GO_TABS.map((t) => t.tab)),
  canToggleLogPane: z.boolean(),
  logPaneOpen: z.boolean()
})
