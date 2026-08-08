# Epona Efficiency Review

_Fresh repo-wide review of current `main` (July 2026), replacing the prior review
whose entire first wave has since been implemented (archived at
`docs/completed/efficiency-review.md`). Report-only swarm over three domains —
main process + IPC, renderer components + stores, and app shell + themes + shared
utils. Excludes `*.test.js`, the `da-win32` native addon, and `out/`/`dist/`/
`node_modules`._

**Headline:** code health is good. The earlier extraction (`gitExec`,
`probeSocket`, `instanceManager`, `worktreeManager` helpers, `BranchSelector`,
`PathPicker`, `SnackbarHost`, `useGitBranches`, `gitDiagnose`, `themes/shared`)
clearly took — remaining duplication is modest and localized. One **real
correctness bug** surfaced (now fixed); the one large remaining opportunity is the
four near-identical fantasy theme files.

**By severity:** correctness 1 (fixed), high 1, medium 4, low 11.

## Outcome (this pass)

**Applied** — the correctness bug (C1) plus all four medium items (pipeChildLines,
launchRepo cleanup, deriveBranchOptions, `<SettingsSection>`) and the low items:
spawnDirect, notifyPidExit, useDotnetRuntime, runBusy, `<PortField>`,
TAB_STACK_SX, ACTIVE_ROW_BG, derive-active-instance-once, base.css dedup. Two
new patterns were lifted into **unit-tested** modules while at it — `childLines`
(pipeChildLines) and `repoRoots` (flush gathering).

**Deliberately skipped** (judgment calls, noted at each finding):
- **#1 theme factory** — known red herring (see below); declined.
- **reapPidInstance (full merge)** — stop vs reset have genuinely different
  kill-failure semantics; a shared helper in 0%-covered lifecycle code risked a
  regression, so only the identical `childExit` notify was extracted.
- **useSnack (R4)** — `SnackbarHost` already captured the real duplication.
- **Tab `value` from TAB_ORDER (A2)** — low urgency; the disabled-legacy-tab case
  makes a naive map riskier than the hardcoded indices are worth.
- **M3/M4** — partial overlap / intentional test seam; left as-is.

---

## Correctness

### C1. `worktrees:flush` dropped its `await` — Flush Worktrees silently no-oped ✅ FIXED
- `main/index.js:516`. `settingsManager.load()` is `async`, but the handler read
  it without `await`, so `settings` was a Promise: `settings?.instances ?? []`
  became `[]` and `clientRepoPath` `undefined`. The handler gathered zero repos
  and returned `{ ok: true, removed: 0 }` — the button reported success while
  doing nothing. Every other `load()` call site awaits.
- **Fix (applied):** `const settings = await settingsManager.load()`.

---

## Won't do (recurring red herring)

### 1. "Collapse the four fantasy themes into a `createFantasyTheme(tokens)` factory" — DECLINED
This surfaces in every review and is a known red herring. The themes only *look*
uniform: alphas vary per theme at the same spots (MuiPaper border
0.32/0.35/0.45/0.32; paper bg 0.82/0.90/0.94/0.88), and there are real structural
deviations — **danaan** especially (`mode:'light'`, heading colors, solid contained
button bg), plus chadul's hover glows and grinneal's asymmetric paper shadow. A
factory needs so many tokens + overrides that the real reduction is modest, for
static low-churn config. `themes/shared.js` (STATUS_COLORS, FANTASY_SHAPE,
fantasyTypography) is the right amount of sharing. **Do not re-propose this.**

<details><summary>Original finding (kept for context)</summary>

### Four fantasy themes are ~99% duplicated — extract a `createFantasyTheme(tokens)` factory
- `themes/hybrasyl.js` (187), `chadul.js` (198), `danaan.js` (201),
  `grinneal.js` (190). All share an identical `components` block (MuiPaper/
  Button/AppBar/Drawer/ListItemButton/Card/Divider/Chip/PaginationItem/Tab/Tabs/
  InputLabel/Checkbox/OutlinedInput) plus identical `shape`/`typography`,
  differing only in ~10 color tokens. `themes/shared.js` already factored out
  `STATUS_COLORS`/`FANTASY_SHAPE`/`fantasyTypography`, but the far larger
  structural body is still copied four times (~600 lines).
- **Proposal:** `themes/createFantasyTheme.js` taking a token object + override
  hooks. **Preserve these intentional per-theme deviations** (model as override
  params, don't flatten them away): chadul's extra hover `boxShadow` glows and
  `contained.color`; danaan's `mode:'light'`, heading color on h1–h6, and solid
  (non-rgba) contained button bg; grinneal's asymmetric paper shadow colors;
  hybrasyl/spark omitting a base `MuiListItemButton.color`. `spark.js` is **not**
  a fantasy theme (own sans typography, `borderRadius:0`) — leave it standalone.
- Folds finding L1 (`'"Cinzel", serif'` literal repeated ~16×) in for free.

---

## Medium value

### 2. Child-stream log wiring duplicated — `pipeChildLines()`
- `main/index.js:283-332` (`wireHybrasylChildLogs`) vs `455-479`
  (`wireInstanceLogs`). Both build two `createLineBuffer`s, wire
  stdout/stderr `data`/`end`, flush on `exit`, drop the tracking entry, emit a
  `*:childExit`, and format spawn errors identically. Only channel names, the
  hybrasyl auto-save `captured[]`, and cleanup differ.
- **Proposal:** `pipeChildLines(child, { onStdoutLine, onStderrLine, onExit, onErrorLine })`
  owning the buffer/data/end/exit/error scaffold; callers supply callbacks.

### 3. `launchRepo` catch re-implements its own `cleanup()`
- `main/targets/serverTarget.js:267-271` (the `cleanup` closure) vs the catch at
  `321-341`, which manually repeats `removeBuildProps → releaseXml →
  releaseServer` with per-step swallowing. The `!result.success` branch (316)
  already calls `cleanup()`.
- **Proposal:** move the per-step `try/catch` swallowing into `cleanup()` itself;
  both the failure branch and the catch collapse to `await cleanup()`.

### 4. Branch-options derivation duplicated 3× — `useBranchOptions()`
- `ServerInstancePanel.jsx:301-316` (server + xml) and
  `HybrasylClientPanel.jsx:158-165`. The same 4-line `cacheEntry`/`error`/
  `loading`/`withSavedBranchPinned(...)` derivation, three times — the largest
  survivor after the `BranchSelector` extraction.
- **Proposal:** `useBranchOptions(branchCache, path, savedBranch)` beside
  `useGitBranches.js`; returns `{ branches, error, loading }`.

### 5. Settings accordion boilerplate repeated 5× — `<SettingsSection>`
- `SettingsPane.jsx` — every section repeats the same
  `disableGutters elevation={0} square expanded={…} onChange={…} sx={ACCORDION_SX}`
  + `AccordionSummary`/`ExpandMoreIcon` props, and the Profiles / World
  Directories summaries duplicate a "title + stopPropagation Add button" header.
  (Introduced by this session's accordion refactor.)
- **Proposal:** a local `<SettingsSection panel title action={…}>` wrapper taking
  `expanded`/`onChange` from the parent.

---

## Low value (localized; batch or defer)

### Main process
- **M1. PID-kill/delete/childExit block duplicated** — `index.js:593-606`
  (`instance:stop`) and `624-634` (`instance:reset`), with `before-quit` (710-722)
  a third variant. Extract `reapPidInstance(instanceId, pid)`.
- **M2. Non-Windows detached-spawn block duplicated** — `serverTarget.js:225-232`
  (`launchBinary`) and `300-307` (`launchRepo`). Small `spawnDirect(spec, cwd, cleanup)`.
- **M3. Worktree-resolve preamble partial overlap** — `hybrasylTarget.js:139-163`
  and `serverTarget.js:249-256`. Real differences (hybrasyl's `gitToplevel`
  guard); optional `resolveWorktree(repoRoot, branch, noGit)` keeping the guard
  at the call site.
- **M4. `resolveInstanceForLaunch` exported only for tests** —
  `instanceManager.js:36`. Acceptable test seam; drop the `export` if testing
  through `resolveSuppliedInstance` is preferred.

### Renderer
- **R1. `.NET runtime` state + mount effect duplicated** — `ServerInstancePanel`
  and `HybrasylClientPanel`. Extract `useDotnetRuntime()` (tiny, high
  value-to-effort).
- **R2. `handleStart`/`handleStop`/`handleReset` triplicated** —
  `ServerInstancePanel.jsx:213-235`. A `runBusy(label, op)` helper.
- **R3. Port fields repeated 4×** — `ServerInstancePanel.jsx:577-655`. A
  `<PortField label value onChange>` (or config-driven `.map`).
- **R4. `snack` state + `<SnackbarHost>` wiring repeated in 3 components** — a
  `useSnack()` returning `{ snack, showSnack, snackHost }`.
- **R5. Tab-content container `sx` literal repeated 4×** —
  `ServerInstancePanel.jsx:328/394/452/564`. Hoist `TAB_STACK_SX`.
- **R6. Hardcoded active-row highlight** — `bgcolor:'rgba(255,255,255,0.06)'` in
  both Settings lists (`353`, `431`), non-theme-aware. Lift to a token.

### App shell / themes
- **A1. `App.jsx` recomputes the active-instance lookup up to 4× per render** —
  `App.jsx:261-263, 341-349`. Derive `const activeInstance = …` once.
- **A2. Tab `value` props hardcoded vs `TAB_ORDER`** — `App.jsx:222-227`. Low
  urgency (order stable; disabled-legacy case complicates a naive `.map`).
- **A3. Duplicate `body { overflow: hidden }`** — `assets/base.css:11` and `24`.
  Trivial cosmetic; delete one.

---

## Verified correct — do not "fix"
- `uiConstants.js` `PANEL_BORDER` / `PANEL_BORDER_COLOR` are both live and the
  white `rgba(255,255,255,0.15)` hairline intentionally overrides each theme's
  tinted `MuiDivider` (documented in-file).
- The `0.2` / `0.1` border literals at `LogPane.jsx:162` and `HelpDialog.jsx:61`
  are intentionally different opacities from the `0.15` token.
- `spark.js`'s `info:{main:'#3080D0'}` override after `...STATUS_COLORS` is a
  deliberate blue-vs-cyan choice.
- The mount-only `useEffect`s in `App.jsx` (`95-104`, `106-132`) with
  `exhaustive-deps` disabled are legitimately mount-only.
- No `memo`/`useMemo`/`useCallback` anywhere in the renderer, so inline
  object/handler literals passed to (non-memoized) children cost nothing today —
  only worth revisiting if a panel is later memoized.
- All `shared/*.js` utils are lean, single-purpose, dependency-free — nothing to do.

---

## Suggested first wave
1. **C1 — flush `await`** ✅ already fixed (real bug).
2. **#2 — `pipeChildLines`** — cleanest main-process dedup.
3. **#4 + R1 — `useBranchOptions` + `useDotnetRuntime` hooks** — small, safe,
   high value-to-effort renderer extractions.
4. **#3 — `launchRepo` cleanup consolidation** — removes an error-path
   inconsistency, not just lines.

> The `createFantasyTheme` factory was item 2 of this list until 2026-08-08. It
> is **declined** — see the "Won't do (recurring red herring)" entry above, and
> `CLAUDE.md`. Recommending it here while rejecting it there is what made the
> proposal keep coming back: a reader scanning top-down reached the
> recommendation last and acted on it. If you are reading this file to decide
> what to work on, the answer on the themes is no.
