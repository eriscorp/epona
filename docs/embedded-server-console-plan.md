# Embedded Server Console — Stage 3.0 follow-up

## Context

Stage 3.0 ships server instance management against a real OS console window: Epona spawns the server through a PowerShell `Start-Process` wrapper that allocates a normal console, runs `dotnet Hybrasyl.dll …`, and pauses on `Read-Host` after exit so the operator can read the last lines. This works, but:

- The console is a separate Win32 window, not part of the launcher
- Two instances mean two stray console windows on the desktop
- Output is not captured — the LogPane (already plumbed via `instance:log` IPC) sits empty for binary-mode instances
- Crash diagnosis means tabbing to the right console window before it closes

The natural next step is to default to capturing the server's stdout/stderr inside Epona's own LogPane, with the external console available as an opt-in for users who want a real terminal.

The blocker is a single line of server code: [hybrasyl/Game.cs:619](e:/Dark Ages Dev/Repos/server/hybrasyl/Game.cs#L619), `Console.ReadKey()`, which throws `InvalidOperationException` when stdin is redirected. That call is the "press any key to exit" pause in the fatal `World.Init()` failure path. Nothing else in the server's startup or runtime requires an interactive console (verified: only one `ReadKey` site in the entire `hybrasyl/` directory; no `CancelKeyPress` handler; `static int Main` returns normally; shutdown is in-game `/shutdown`).

That makes Option 1 (coordinated upstream change) cheap: a two-line guard server-side, then a focused launcher rework to spawn directly with piped stdio.

---

## Part A — Server change (hybrasyl repo)

**Branch:** `feature/skip-readkey-when-redirected` (or fold into the next server PR)
**File:** [hybrasyl/Game.cs](e:/Dark Ages Dev/Repos/server/hybrasyl/Game.cs)

Replace the unconditional `ReadKey()` at line 619 with a redirected-stdin guard:

```csharp
if (!World.Init())
{
    activity?.SetStatus(ActivityStatusCode.Error);
    Log.Fatal(
        "Hybrasyl cannot continue loading. A fatal error occurred while initializing the world.");
    if (!Console.IsInputRedirected)
    {
        Log.Fatal("Press any key to exit.");
        Console.ReadKey();
    }
    Environment.Exit(1);
}
```

Behavioral effect:
- Standalone console launch (operator running `dotnet Hybrasyl.dll` in a terminal): unchanged — still pauses on keypress so the fatal line is readable
- Launcher-managed launch (Epona, CI, any wrapper that pipes stdio): no pause, exit immediately with code 1; the launcher already shows the fatal line in its log surface

Done. No new dependencies, no API changes, no config knobs.

### Verification (server)

1. Run `dotnet hybrasyl/bin/.../Hybrasyl.dll --datadir <bad>` in a real terminal with a `--datadir` that triggers `World.Init()` failure. Confirm "Press any key to exit." prints and the process waits.
2. Pipe the same command through a wrapper that redirects stdin (e.g. `echo | dotnet …` or any script that captures stdio). Confirm the process exits immediately with code 1, no `InvalidOperationException`.
3. Existing server tests stay green (this code path has no test coverage today; not adding one for a one-line guard).

---

## Part B — Epona change (this repo)

**Branch:** `stage/3.0a-embedded-console`
**Goal:** A per-instance "Show external console window" toggle. Default off — server output streams into the existing LogPane. When on, fall back to the current PowerShell wrapper unchanged.

### Modified files

**[src/main/targets/serverTarget.js](e:/Dark Ages Dev/Repos/epona/src/main/targets/serverTarget.js)**
- Split the spawn path. Today `launch(instance)` always builds the PS-wrapper command. Replace with:
  ```js
  if (instance.showExternalConsole) {
    return launchExternalConsole(instance)  // current PS-wrapper logic, renamed
  }
  return launchEmbedded(instance)            // new
  ```
- `launchEmbedded(instance)`:
  - Use `child_process.spawn(spec.command, spec.args, { cwd: instance.worldDataDir, env: { ...process.env, ...spec.env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })`
  - Wire `child.stdout` and `child.stderr` through `createLineBuffer` (already in [src/main/lineBuffer.js](e:/Dark Ages Dev/Repos/epona/src/main/lineBuffer.js)) to emit `instance:log` events with `{ instanceId, stream: 'stdout'|'stderr', line }`
  - On `child.exit`, emit `instance:childExit` with `{ instanceId, pid, code, signal }` — same payload the renderer already consumes
  - Return `{ success: true, pid: child.pid }` and stash `{ kind: 'child', value: child }` in `instanceChildren` so the existing stop handler in [src/main/index.js](e:/Dark Ages Dev/Repos/epona/src/main/index.js) can `child.kill()` it (no taskkill needed — there's no detached process group, just a direct child of the launcher)
- Keep `buildBinarySpawn`, `resolveConfigFile`, `validateForLaunch`, `resolveRedisTarget` exactly as they are — they're already the right shape for both paths

**[src/main/index.js](e:/Dark Ages Dev/Repos/epona/src/main/index.js)**
- Update the `instance:stop` handler to handle `kind === 'child'`: call `tracked.value.kill()` directly. Leaves the existing `kind === 'pid'` taskkill path alone for external-console instances.
- No new IPC needed — `onInstanceLog` and `onInstanceChildExit` already exist in preload and renderer

**[src/main/settingsManager.js](e:/Dark Ages Dev/Repos/epona/src/main/settingsManager.js)**
- Add `showExternalConsole: false` to `DEFAULT_INSTANCE`
- Update `coerceInstance` to fill the field (defaulting to `false`) when migrating older saved instances

**[src/renderer/src/components/ServerInstancePanel.jsx](e:/Dark Ages Dev/Repos/epona/src/renderer/src/components/ServerInstancePanel.jsx)**
- Add a `FormControlLabel` + `Checkbox` row labeled "Show external console window" bound to `selected.showExternalConsole`. Place it near the bottom of the detail form, just above Start/Stop, with helper text: `"Off: server output appears in the log pane. On: server runs in its own console window."`
- No other UI changes — the LogPane toggle button stays where it is and now actually shows useful content for binary-mode instances by default

**Tests:**
- [src/main/targets/serverTarget.test.js](e:/Dark Ages Dev/Repos/epona/src/main/targets/serverTarget.test.js) — `buildBinarySpawn` / `validateForLaunch` cases unchanged. Add no spawn-mode tests here; the spawn behavior is exercised end-to-end manually since both paths shell out to `child_process.spawn` and there's nothing meaningfully testable in the spawn options without mocking the world.
- [src/main/settingsManager.test.js](e:/Dark Ages Dev/Repos/epona/src/main/settingsManager.test.js) — extend the "fills missing fields on each instance with defaults" test to assert `showExternalConsole === false` after coercion of a pre-existing instance that lacks the field

### Reused utilities

- `createLineBuffer` ([src/main/lineBuffer.js](e:/Dark Ages Dev/Repos/epona/src/main/lineBuffer.js)) — already powers Hybrasyl client log streaming; plug it in unchanged
- `instance:log` and `instance:childExit` IPC — already plumbed through preload and consumed in [src/renderer/src/App.jsx](e:/Dark Ages Dev/Repos/epona/src/renderer/src/App.jsx); the embedded path just starts using channels that were previously defined-but-unused for binary mode
- `LogPane` ([src/renderer/src/components/LogPane.jsx](e:/Dark Ages Dev/Repos/epona/src/renderer/src/components/LogPane.jsx)) — no changes; its scrollback, auto-scroll, and clear behavior are exactly what we need
- `instanceChildren` map in [src/main/index.js](e:/Dark Ages Dev/Repos/epona/src/main/index.js) — already discriminates `{ kind, value }`; the existing `'pid'` branch covers external-console instances, the new `'child'` branch covers embedded ones

### Documentation

- Update [docs/multi-target-expansion-plan.md](e:/Dark Ages Dev/Repos/epona/docs/multi-target-expansion-plan.md) Stage 3.0 section: add a one-line note that the embedded-console path requires server commit `<sha>` (the `Console.IsInputRedirected` guard) and link this plan
- Document the minimum required server commit in the README the same way the Chaos.Client `LobbyHost`/`LobbyPort` cfg requirement is documented in Stage 2

---

## Out of scope (intentionally deferred)

- **Stdin input box in the LogPane.** The user originally asked about "a text box that sends input to a hidden window." The wire is free in this design (we already pipe stdin), but the server has no stdin command surface today — anything we typed would land in the void. Skip the UI for now; revisit when the server grows admin commands. When it does, the change is purely renderer-side: a `<TextField>` at the bottom of `LogPane` that calls a new `sparkAPI.writeInstanceStdin(id, text + '\n')` IPC, which writes to the tracked `child.stdin`. Main-process plumbing is already there.
- **Console emulator (ANSI colors, cursor positioning).** The server uses Serilog's plain console sink; no ANSI sequences worth interpreting. Don't pull in `xterm.js`. The current LogPane (plain `<div>` per line) is correct for this output.
- **ConPTY / `node-pty`.** Was the alternative for "no upstream change required." With the server change in Part A, we don't need it. Don't add a native dep we don't need.
- **Auto-restart on crash.** Out of scope; the LogPane already shows the exit code clearly and the user can hit Start again. Adding restart policy is a real feature, not a knob.

---

## Risks

- **Server change must land first.** If we ship the embedded path before the server has the `IsInputRedirected` guard, an Epona user who hits a `World.Init()` failure (bad XML, missing maps, etc.) gets an `InvalidOperationException` stack trace instead of the friendly fatal log line. Mitigation: gate the embedded mode on a server-version check, OR just sequence the merges (server PR first, Epona PR after — this is the same coordinated-dependency model as Stage 2's Chaos.Client cfg patch).
- **Long-running servers produce a lot of output.** The LogPane caps at `LOG_CAP = 2000` lines per instance ([src/renderer/src/App.jsx](e:/Dark Ages Dev/Repos/epona/src/renderer/src/App.jsx)), which is fine for a few hours but will roll over for production-style runs. Acceptable for v1; revisit if users complain. Serilog file sinks already write the full log to disk independently.
- **`child.kill()` semantics on Windows.** Sending SIGTERM to a Windows process via `child_process` translates to `TerminateProcess`, which is hard kill — equivalent to today's `taskkill /F` for the embedded case. The server has no graceful-stop hook short of `/shutdown` anyway, so this matches current behavior.
- **A user who toggles the checkbox while the instance is running** gets confusing behavior on next Start. Decide: either disable the checkbox while `runningIds.has(instance.id)`, or accept that the toggle takes effect on next launch. Lean toward disabling — same pattern as the other config fields.

---

## Verification

1. `npm test` in `epona` — settingsManager, serverConfigs, serverTarget tests stay green; new default-fill assertion passes.
2. Build the server with the Part A patch, point an Epona instance at the new `Hybrasyl.dll`.
3. With "Show external console window" **off** (default):
   - Click Start. Confirm no console window appears. LogPane shows server stdout starting from the first line (Serilog banner, "Datastore: …", world load progress).
   - Click the LogPane toggle to confirm it shows the embedded output. Confirm `LOG_CAP` trimming works during a long load.
   - Click Stop. Confirm the child exits and the exit marker line appears in the LogPane.
4. With "Show external console window" **on**:
   - Click Start. Confirm a real console window appears with the same output (current Stage 3.0 behavior).
   - Click Stop. Confirm taskkill closes the window and removes the running flag.
5. Trigger a fatal `World.Init()` failure (point `worldDataDir` at an empty directory or one with broken XML) on an embedded-mode instance:
   - Confirm the fatal log line appears in the LogPane
   - Confirm the process exits cleanly with code 1 (no `InvalidOperationException`)
   - Confirm Epona's "running" flag clears via the existing `instance:childExit` flow
6. `npm run build` — clean.

---

## End state

- One Epona instance = one tab in the launcher, one log surface in the launcher. No stray console windows on the desktop unless the operator explicitly asks for one.
- Crash diagnosis improves: the LogPane stays open after exit (no need to race a closing console window), and the existing scrollback / clear / open-in-pane affordances all work the same way Hybrasyl Client logs already do.
- The toggle preserves the operator-friendly "real console" mode for users who want it (e.g. attaching a debugger via the console, copy-pasting from the native window, sharing screenshots that look like a server console).
- Total upstream surface: one server PR, ~5 lines of net new code. Total Epona surface: one new spawn function, one settings field, one checkbox. No new dependencies in either repo.
