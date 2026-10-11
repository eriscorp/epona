import { gitInstallHint } from './installHints'

// Map a diagnoseGitRepo result to a snackbar payload + the patch fields the
// picker should write. The 'no_git' / 'not_repo' branches accept the path and
// flip a per-repo noGit flag so the launcher can skip the worktree dance and
// run directly. The 'no_path' / 'git_error' branches refuse the path.
//
// `notRepoNoun` is the trailing phrase for the not_repo warning — the two
// panels differ only in whether they say "…the picked folder." (server) or
// "…the picked .csproj." (client).
//
// Only a folder pick calls this, so it is a manual action: main may ask git
// again after a cached "Command Line Tools missing" (macOS).
export async function diagnoseAndExplain(p, { notRepoNoun }) {
  const diag = await window.sparkAPI.diagnoseGitRepo(p, { manual: true })
  if (diag.ok) return { accept: true, noGit: false, snack: null }
  // macOS without the Command Line Tools: git cannot run, as with no git at all.
  // The message names the command to run (xcode-select --install).
  if (diag.reason === 'no_clt') {
    return {
      accept: true,
      noGit: true,
      snack: {
        severity: 'warning',
        duration: 10000,
        message: `${diag.message}. Branch switching disabled. Pick the folder again after the install.`
      }
    }
  }
  if (diag.reason === 'no_git') {
    return {
      accept: true,
      noGit: true,
      snack: {
        severity: 'warning',
        duration: 10000,
        message:
          'Git not detected on PATH. Branch switching disabled. ' +
          gitInstallHint(window.sparkAPI.platform)
      }
    }
  }
  if (diag.reason === 'not_repo') {
    return {
      accept: true,
      noGit: true,
      snack: {
        severity: 'warning',
        duration: 8000,
        message:
          'No .git/ found in this folder or its parents. Branch switching disabled — ' + notRepoNoun
      }
    }
  }
  if (diag.reason === 'no_path') {
    return {
      accept: false,
      noGit: false,
      snack: { severity: 'error', message: "Folder doesn't exist or isn't accessible." }
    }
  }
  return {
    accept: false,
    noGit: false,
    snack: { severity: 'error', message: `Git error: ${diag.message ?? 'unknown'}` }
  }
}
