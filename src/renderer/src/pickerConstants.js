// Shared styling + sentinel used by the path pickers and branch selectors on
// both the server-instance and Hybrasyl-client panels.

// Monospace, single-line-with-ellipsis style for the resolved-path text shown
// next to a Browse… button.
export const PICKER_SX = {
  flex: 1,
  fontFamily: 'monospace',
  fontSize: 11,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis'
}

// Sentinel branch value meaning "leave the repo on whatever branch it's already
// checked out" — stored as null on the instance, surfaced as this string in the
// Select so MUI has a concrete option value to bind to.
export const CURRENT_CHECKOUT_VALUE = '__current_checkout__'
