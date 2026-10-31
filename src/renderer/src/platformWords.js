// Words in the interface that differ by OS (HTOO-596). The text named
// Explorer, a Windows path and a .exe on macOS and Linux too.

export function fileManagerName(platform) {
  if (platform === 'win32') return 'Explorer'
  if (platform === 'darwin') return 'Finder'
  return 'the file manager'
}

// A JSX attribute string does not process escapes, so the old
// placeholder="C:\\Hybrasyl\\world" showed two backslashes on every OS (F20).
export function worldFolderPlaceholder(platform) {
  if (platform === 'win32') return 'C:\\Hybrasyl\\world'
  if (platform === 'darwin') return '/Users/you/Hybrasyl/world'
  return '/home/you/hybrasyl/world'
}

// The server binary: a .dll anywhere, a .exe on Windows, and the apphost with
// no extension that `dotnet publish` makes for macOS and Linux (F10).
export function serverBinaryLabel(platform) {
  return platform === 'win32' ? 'Binary Path (.dll or .exe)' : 'Binary Path (.dll or program)'
}

export function serverBinaryFilters(platform) {
  return platform === 'win32'
    ? [{ name: 'Hybrasyl server (.dll or .exe)', extensions: ['dll', 'exe'] }]
    : [
        { name: 'Hybrasyl server', extensions: ['*'] },
        { name: '.NET assembly (.dll)', extensions: ['dll'] }
      ]
}
