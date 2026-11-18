// The file in resources/ that each window's `icon` option names.
//
// Linux takes the square tile, the same artwork as the installed hicolor icon
// (Sabrael, 2026-11-17, HTOO-663). A desktop that matches the window to the
// installed .desktop file draws the tile from there anyway. One that cannot,
// such as an AppImage with no desktop integration or some X11 window lists,
// draws the window's own icon, and that was the star. The tile is a copy of
// build/icons/256x256.png that scripts/make-icons.mjs writes, and
// scripts/icons.test.mjs pins the copy.
//
// Windows keeps the star: it is the Windows artwork, and the packaged app takes
// its icon from the exe resource. macOS ignores the option.

/**
 * @param {string} platform `process.platform`.
 * @returns {string} A file name in resources/.
 */
export function windowIconFile(platform) {
  return platform === 'linux' ? 'epona-icon-linux-256.png' : 'epona-icon-256.png'
}
