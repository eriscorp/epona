// Single adapter seam for the portable Report Issue / diagnostics module and the
// update-check module. Every ported renderer file (reportErrors, ErrorBoundary,
// ReportIssueDialog, AboutDialog, UpdateNotice, UpdateCheckButton) reaches the
// preload through this one getter, so adopting either module in a sibling
// app that exposes `window.api` instead of `window.sparkAPI` is a one-line change
// here rather than an edit across each component.
export const bridge = () => window.sparkAPI
