// One sentence per outcome of the Dark Ages folder check, written for the panel
// rather than for a log.
//
// Lives in src/shared rather than beside inspectAssetDir in src/main because the
// renderer is what displays it, and the renderer may not import from src/main —
// that module touches `fs`. The split is the usual one: main answers the
// question, shared says what the answer means, and the wording is testable
// without a filesystem.
export function describeAssetDir(result) {
  if (!result) return ''
  if (result.ok) {
    return `${result.datCount} Dark Ages data file${result.datCount === 1 ? '' : 's'} found`
  }
  switch (result.reason) {
    case 'unset':
      return 'No folder selected yet'
    case 'missing':
      return 'That folder no longer exists'
    case 'not-a-directory':
      return 'That is a file, not a folder'
    case 'no-dat-files':
      return 'No .dat files here — this does not look like a Dark Ages folder'
    default:
      return 'Cannot read that folder'
  }
}
