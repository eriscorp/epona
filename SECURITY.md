# Security policy

## What Epona is

Epona is a **local-first desktop launcher** for Dark Ages and Hybrasyl. It runs on one machine, for
one person, over files that are already on that machine. It has no server, no accounts, and no
telemetry. It launches game clients and local server processes, patches a client's memory at
startup on Windows, and runs `git` against repositories you point it at.

That shape decides what a vulnerability in Epona can be. There is no service to attack and no other
user's data to reach. What is left is the boundary between untrusted input and a process that
launches executables, writes to disk, and writes into the memory of another process.

## The trust boundary

The main process is the only code that touches the filesystem, spawns processes, or loads the
native addon. The renderer asks it to.

| Surface               | What guards it                                                                                                                                                                                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings crossing IPC | Zod-validated against `src/main/schemas/settings.js` on save, and validated again on load; a settings file that fails validation is refused rather than partially applied.                                                                                                               |
| Settings on disk      | Written atomically (temp file → rename, with a retry for the Windows antivirus EPERM race) and kept with a backup, so an interrupted write cannot leave a truncated config.                                                                                                              |
| Window navigation     | The main window may not navigate away from the bundle it loaded. A `will-navigate` to any other URL is cancelled.                                                                                                                                                                        |
| Opening a link        | `http`, `https` and `mailto` only (`src/shared/externalUrl.js`). A `file:`, `smb:` or custom-scheme URL is refused rather than handed to the operating system.                                                                                                                           |
| Report Issue payloads | Zod-validated at the IPC boundary; the diagnostics block is scrubbed of usernames, home directories, deep file paths, e-mail addresses and IPv4 addresses before it is ever shown.                                                                                                       |
| Bug reports           | Assembled locally, scrubbed, and shown to you **editable** for review. Nothing is sent anywhere until you press the button, and then only to the GitHub issue page it opens.                                                                                                             |
| Session logs          | Scrubbed once at capture, in main, so every source — main errors, renderer errors, React boundary catches — lands already safe to hand to a bug report. Five sessions are kept.                                                                                                          |
| Client memory patches | Every original byte is verified before anything is written, the patch is verified after writing, and any failure rewinds in reverse order. A partially patched client is never resumed — it is terminated (`src/main/patches/installer.js`).                                             |
| Git operations        | Arguments are passed as an argv array to `spawn` with no shell (`src/main/gitExec.js`), so a branch or path containing shell metacharacters is data rather than a command.                                                                                                               |
| Renderer process      | Runs in the OS sandbox (`sandbox: true`), with context isolation on and Node integration off. The preload requires nothing beyond `electron`, which is what makes that possible; `e2e/preload-sandbox.spec.js` asserts it stays that way.                                                |
| Renderer → main IPC   | Every handler registers through a guarded `ipcMain` (`src/main/windowSecurity.js`) that accepts a message only from the top frame of a window Epona itself created, at a location Epona itself loaded. Subframes, unregistered windows and a window that navigated away are all refused. |
| Shipped binary        | Hardened with Electron fuses: `runAsNode`, `--inspect` arguments and `NODE_OPTIONS` are disabled, and app code loads only from `app.asar`. Without the first, `ELECTRON_RUN_AS_NODE=1 Epona.exe -e "…"` would turn the signed binary into a general-purpose Node interpreter.            |

### What is deliberately not guarded, and why

Epona is a developer and player tool that exists to run programs you choose. **The paths you
configure — client executables, server binaries, repositories, world data directories — are trusted
by design.** There is no allowlist of roots, because naming the thing to launch is the entire
feature. `detectProtectedLocation` in `src/shared/protectedPaths.js` warns about OneDrive and
Program Files, but that is a launch-failure explanation, not a security control.

The consequence: **anyone who can write to your settings file can make Epona launch anything.** At
that point they can already run programs as you, so Epona is not the weak link — but do not treat
`settings.json` as untrusted input that Epona hardens against.

## Known gaps

None outstanding. This section listed three — the scaffold's `sandbox: false`, no IPC sender check,
and no Electron fuses — and all three are closed; see _Renderer process_, _Renderer → main IPC_ and
_Shipped binary_ in the table above.

Kept as a heading rather than deleted, because the next gap should land here rather than going
unrecorded.

## Reporting a vulnerability

Open an issue at **<https://github.com/hybrasyl/cernunnos/issues>** — the shared intake repo — and
apply the `app:epona` label. In-app, **Settings → About → Report an issue** does this for you and
attaches a scrubbed diagnostics block you can edit before it is submitted.

If a report would itself expose something sensitive, say so in a short issue without the detail and
ask for a private channel rather than posting it.

Epona is distributed to a small team and has no formal SLA. Expect a look within a few days.

## Supported versions

The latest release only. Epona ships forward; there are no maintenance branches.

## Dependency and supply-chain posture

- **Production dependencies are audited in CI.** `npm audit --omit=dev --audit-level=high` runs on
  every pull request and every push to `main`, and it currently reports zero.
- **The dev tree is audited by hand**, not gated. Build-time tools do not ship inside the app, so an
  advisory in one is something to schedule rather than something that should block an unrelated
  change. Run a bare `npm audit` whenever you touch dependencies.
- **There is no Dependabot, and that is a decision rather than an oversight.** It was tried across
  these projects and produced noise instead of signal. Dependency and action bumps are made by hand,
  deliberately, when a deprecation or an advisory surfaces one.
- **`app.asar` is packaging, not a security boundary** — anyone holding a build can read its
  contents. The `files` allowlist in `electron-builder.yml` exists to keep development trees out of
  the payload, not to hide anything.
- **Windows artifacts are Authenticode-signed** through SSL.com eSigner when signing credentials are
  configured; the step self-skips otherwise, so unsigned builds are possible and are what unofficial
  builds will be. **macOS builds are Developer ID-signed, notarized and stapled** — both the `.app`
  and the `.dmg`.

## Out of scope

Findings that require an attacker to already control the machine, the user account, or the local
filesystem. Epona launches what you tell it to launch; at that point they can launch it themselves.
