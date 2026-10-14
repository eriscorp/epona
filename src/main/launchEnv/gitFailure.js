/**
 * HOUSE MODULE — launch-env v1 (JS port; types stripped. mabon WP98, HTOO-512;
 * design: oghma WP34).
 * Copied verbatim between the house apps that run git; it imports nothing from
 * the app. hyb-electron-template owns it: change it there, then port it to the
 * rest. Pure: it reads git's stderr and names the cause. It never changes what
 * git does.
 */

/**
 * The Xcode Command Line Tools are missing, or a macOS upgrade broke them.
 *
 * `/usr/bin/git` on macOS is a shim that always exists, so a spawn never fails
 * with `ENOENT` there. Without the tools the shim exits non-zero with the first
 * text below, and may raise the system "install developer tools" dialog. After an
 * upgrade that removes them, it prints the second. `xcode-select --install`
 * fixes both.
 */
export function isCltFailure(stderr, platform) {
  if (platform !== 'darwin') return false
  return (
    /xcode-select: note: no developer tools were found/i.test(stderr) ||
    /xcrun: error: invalid active developer path/i.test(stderr)
  )
}

/** What to tell the user. It does not say "git is not installed": on a Mac that
 *  sends people to download git, which does not fix the shim. */
export const CLT_MESSAGE =
  'The Xcode Command Line Tools are missing or broken. Run: xcode-select --install'

/**
 * A failure because git or ssh needed to ask the user something. Under
 * `GIT_TERMINAL_PROMPT=0` and ssh's `BatchMode=yes` they fail fast instead of
 * asking, which is correct, but git's own text does not say so. Measured on
 * macOS for HTOO-298: `BatchMode` does not change this text.
 */
/** @typedef {'publickey' | 'host-key' | 'no-prompt'} CredentialFailure */

/** Classify the stderr of a network call (`pull`, `push`, `push -u`). */
export function classifyCredentialFailure(stderr) {
  if (/Permission denied \(publickey/i.test(stderr)) return 'publickey'
  if (/Host key verification failed/i.test(stderr)) return 'host-key'
  if (/could not read Username|terminal prompts disabled/i.test(stderr)) return 'no-prompt'
  return null
}

/** The sentence for a credential failure. git's own text is shown under it. */
export function credentialMessage(kind, appName) {
  switch (kind) {
    case 'publickey':
      return `Your SSH key was not available to ${appName}. If git works in Terminal, see "macOS and Linux setup" in the ${appName} README.`
    case 'host-key':
      return `This computer has not connected to the remote over SSH before. Connect once in Terminal to accept its host key (for GitHub: ssh -T git@github.com).`
    case 'no-prompt':
      return `git needed a password, and ${appName} cannot ask for one. Set up a credential helper, for example: gh auth setup-git.`
  }
}
