# Authority model

This document tells how Epona's main process decides which programs and repositories it may run. It fixes HTOO-685. Taliesin and Creidhne have the same model for their own paths (their `docs/authority-model.md`, HTOO-673 to HTOO-675 and HTOO-679). Keep the three aligned.

## The rule

The renderer writes settings.json. So settings.json is not the record of what Epona may run. Main keeps that record in `grants.json`, and only main writes it.

The threat is a renderer that runs code it should not (a compromised renderer). The user's own choices are trusted: a program that the user picks in a dialog runs.

## The parts

| Part | Where | What it holds |
| --- | --- | --- |
| `grants.json` | Beside settings.json (`%LOCALAPPDATA%\Erisco\Epona`) | `version`, `paths`: the launch paths that settings.json names and that have a grant |
| Session grants | Memory, this session only (`launchGrants.js`) | Every path a native dialog returned, and the paths a Dark Ages install unpacked |
| `launchPaths()` | `src/main/launchGrants.js` | The settings fields that Epona runs, below |
| `instance:openLogDir` | `src/main/openLogDir.js` | The log-folder button, which takes an instance id and no path |

The launch paths:

- `clientPath`: the legacy client (Darkages.exe) on Windows, and the Dark Ages folder elsewhere.
- `targets.hybrasyl.binaryPath`, and `targets.hybrasyl.clientRepoPath`, the .csproj that `dotnet run` builds.
- For each server instance: `binaryPath`, `serverRepoPath` (`dotnet run` builds it), and `xmlRepoPath` (the build takes it as a project reference).

The world folder and the log folder are data, not launch paths.

## How a path gets a grant

1. The user chooses it in a native dialog: `dialog:openFile`, `dialog:openDirectory`, `dialog:openExe`, `installer:pickInstaller` or `installer:pickDestination`. Main records the result as a session grant.
2. A Dark Ages install finishes. Main records the folder and the program that it unpacked, because the renderer then saves one of them as `clientPath`.
3. The one-time migration. When grants.json does not exist, main grants each launch path that settings.json names, once. It reads settings.json at start-up, before the window exists.

## Saves

`settings:save` checks each launch path in the renderer's settings. A path that has a grant (in grants.json or in this session) is saved. A path that has none is not: the field keeps its value from disk when that value has a grant, and becomes empty when not. Main writes each refusal to the session log. Then grants.json holds the launch paths of the saved settings, and nothing else, so a path that the settings no longer name loses its grant.

So a save can keep a grant or remove it, and it never adds one. A save can copy a granted path to another field, for example a second instance on the same server binary.

Saves run one at a time, in order, because each one reads the file that the one before it wrote.

## Launches

Each launch reads its paths from settings.json, as before (the renderer's payload gives only an id), and checks each one against the grants:

- `client:launch` with `legacy` (Windows): `clientPath`.
- `client:launch` with `hybrasyl`: the binary in binary mode, the .csproj in repo mode.
- `instance:start` and `instance:reset`: the binary in binary mode; the server repo and the XML repo in repo mode. A reset checks before it stops the running server.

A path with no grant does not run: the launch returns "Epona has no record that you chose …". That happens only when a path reached settings.json other than through a save: a hand edit, or a grants.json that did not parse.

## The grant is the path

Taliesin and Creidhne record each program's SHA-256 and refuse one whose bytes changed. Epona does not (Sabrael, 2026-11-17). Epona runs Brigid and server builds that change at each rebuild, so a hash would make the user choose the program again after each build. No IPC channel lets the renderer write a program's bytes, so the hash would guard only against a change from outside Epona.

## The other paths

- **`shell:openPath` is gone.** `shell.openPath` runs a program when it is given one, so a renderer-supplied path was a second way to start a program. `instance:openLogDir(instanceId)` replaces it: main reads the instance's `logDir` from settings.json, requires a folder, and on macOS refuses an application bundle (a `.app` name, or an `Info.plist` or `Contents/Info.plist` inside).
- **The installer** unpacks only from an installer and into a folder that a picker returned, or that has a grant. An unpack writes files into the folder it is given.
- **The Client Executable field** in Settings is display-only. Browse is the only way to set it.

## What stays open

- **Generic pickers.** `dialog:openFile` and `dialog:openDirectory` take their title and filters from the renderer. A compromised renderer can show a dialog with a misleading title, and a path that the user then picks gets a grant. That needs the user to choose the program.
- **Git in a renderer-named folder.** `git:listBranches`, `git:diagnoseGitRepo` and `worktrees:remove` run git in a path from the renderer. Git runs a program only from that repository's own configuration (for example `core.fsmonitor`), which the renderer cannot write.
- **A race.** A path can change between the check and the spawn. The check closes every case where the change happens first.

## Tests

- `src/main/launchGrants.test.js`: the migration, a grants.json that does not parse, a forged save, a dialog result, a copied or cleared field, the launch check, and case on Windows. On a real temp folder.
- `src/main/index.authority.test.js`: main booted on a real settings.json and grants.json. A forged client binary, server binary and server repo are not saved; a picked path is saved and launched; a hand-edited path does not launch (Hybrasyl client, server, and the legacy client on Windows). With the save check or the launch check removed, the suite fails.
- `src/main/openLogDir.test.js`: a file, a missing folder and a macOS bundle are refused.
- `e2e/launch-authority.spec.js`: the same in the built app, through the real preload. It fails on a build with the save check removed.
