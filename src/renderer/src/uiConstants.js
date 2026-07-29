// Shared UI constants. The panel divider border is hard-coded (rather than
// theme.palette.divider) so every theme renders the exact same 1px hairline —
// the divider color is intentionally theme-independent.
export const PANEL_BORDER = '1px solid rgba(255, 255, 255, 0.15)'
export const PANEL_BORDER_COLOR = 'rgba(255, 255, 255, 0.15)'

// Layout widths, in CSS pixels. These are the app's PREFERRED size, not a
// contract: App.jsx asks main to size the window to MAIN_W + one PANE_W per
// open pane, but the OS is free to hand back less (a scaled display's frame
// delta, a work area too small for the request). The layout below must
// therefore render to the viewport it actually got — the main panel shrinks,
// the panes stay rigid — rather than to the number it asked for. Laying out to
// the requested width inside a smaller viewport is precisely what produced the
// 29px right-edge overflow; see e2e/content-overflow.spec.js.
//
// Single source of truth on purpose: PANE_W used to be declared here-ish in
// both App.jsx and SettingsPane.jsx, with nothing keeping the two in sync.
export const MAIN_W = 480
export const PANE_W = 360
