// Advice for a server build failure that the build output does not explain.
// The line goes to the instance's log on stderr, and the exit notice quotes
// the run's last stderr line (serverExitNotice.js), so the advice is seen with
// the Log Pane closed.

// Grpc.Tools ships only x86_64 `protoc` and `grpc_csharp_plugin` for macOS
// (HS-1677). On Apple Silicon with no Rosetta, the build stops with MSB6003 and
// Win32Exception (86), "Bad CPU type in executable", and an exit code 1 (HTOO-591).
// Read from the output rather than probed before the launch: a server whose
// build needs no x86_64 tool must still start on a Mac with no Rosetta.
export const ROSETTA_HINT =
  '[epona] The build needs Rosetta on this Mac. Run: softwareupdate --install-rosetta --agree-to-license'

const BAD_CPU = /Bad CPU type in executable|\bMSB6003\b.*\(86\)/

/**
 * @param {string} line one line of a server's build or run output
 * @param {string} [platform]
 * @returns {string|null} the advice for that line, or null
 */
export function buildHint(line, platform = process.platform) {
  if (platform === 'darwin' && BAD_CPU.test(line)) return ROSETTA_HINT
  return null
}
