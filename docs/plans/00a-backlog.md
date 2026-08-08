# Backlog & deferral register

Everything Epona has consciously declined, with the reason and the **trigger** that would reopen it. Read [`00-overview.md`](00-overview.md) first — it holds the settled decisions and the release record.

**Not a work package and not versioned.** It outlives both. Shipped work is recorded in `complete/` and in `CHANGELOG.md`; nothing here is scheduled.

**Why this file exists.** Twice now an Epona plan document has been archived with open items inside it, and both times the thing that got lost was a _decline_. The 2026-07-12 efficiency review recommended the `createFantasyTheme` factory in a "Suggested first wave" list while its own prose declined the same idea two sections above; a reader scanning top-down reached the recommendation last and acted on it, twice. Deleting a decline loses the reasoning, and filing one as a card makes it read as sanctioned work. **Recording it here, with the trigger that would reopen it, is what breaks the loop** (HTOO-330, 2026-08-08).

**Owed vs parked.** An item is _owed_ — and belongs in a milestone section of `00-overview.md`, or on a card — if it was promised to a date or specified by shipped work and never built. Everything else is parked here behind a named trigger, or is a permanent non-goal. Conflating the two is how a promise quietly becomes an idea.

**Before you propose a cleanup, read this file.** If your proposal is below, the burden is to show its trigger has fired — not to re-argue the item from scratch.

---

## Permanent non-goal

### The `createFantasyTheme(tokens)` factory — DECLINED, no trigger

`src/renderer/src/themes/` holds six hand-written theme objects, and collapsing them into a generator has now been proposed by three separate review passes and declined every time. They only _look_ alike. `danaan` in particular carries per-component overrides that no token set expresses, and a factory that took every one of them as a parameter would be longer than the six files and harder to read than any of them.

**There is no trigger.** This is not deferred work. It is on the record here so the fourth proposal costs a paragraph instead of a build.

---

## Parked — declined by the 2026-07-12 efficiency review, with triggers

The five survivors of `complete/efficiency-review-2026-07-12.md`, carried here when that file was retired (HTOO-330). Each is a decision the review itself made with its reasoning recorded. **All five were re-verified against `main` on 2026-08-08** and still describe the code; the two places where the original wording has since drifted are noted.

- **M3 — the worktree-resolve preamble in `targets/hybrasylTarget.js` and `targets/serverTarget.js`.** The review's own word for extracting it is "optional". The overlap is partial and the difference is real: the hybrasyl path carries a `gitToplevel` guard the server path does not, so a `resolveWorktree(repoRoot, branch, noGit)` helper would have to keep that guard at the call site anyway. **Trigger:** a third caller needing the same preamble.

- **M4 — `resolveInstanceForLaunch` exported for tests only** (`src/main/instanceManager.js:36`). The review calls it an acceptable test seam and offers dropping the `export` as a preference, not a fix. A one-word judgment call with no defect behind it. **Trigger:** none. Decide it if the module is being reworked for another reason.

- **R4 — a `useSnack()` hook.** Skipped because `SnackbarHost` already captured the real duplication; what remains is four components (`ActionButtons`, `HybrasylClientPanel`, `ServerInstancePanel`, `SettingsPane`) each holding a two-line `snack` state. **Trigger:** a fifth consumer, or snack behaviour that has to change in one place and cannot.

- **A2 — the tab `value` props hardcoded rather than derived from `TAB_ORDER`** (`src/renderer/src/App.jsx:243-245`). Skipped because the disabled-legacy-tab case made a naive `.map` riskier than three stable literals were worth. **This is now more true, not less:** HTOO-296 means the Legacy tab is no longer disabled on any platform, so the indices are stable and a mapping is the only thing that could destabilise them. **Trigger:** the tab set becoming dynamic.

- **Renderer memoization.** Explicitly conditional in the review: worth revisiting only once a panel is memoized, because inline object and handler literals passed to non-memoized children cost nothing. **Trigger:** the first `memo()`ed panel — and that is still the trigger, unfired: `grep 'memo('` over `src/renderer/src/**/*.jsx` returns nothing on `main`. **The review's supporting sentence has drifted, though.** It read "no `memo`, `useMemo` or `useCallback` in any `.jsx`", and `useCallback` has since arrived in `DarkAgesInstallPanel.jsx`, `LegacyAssetsPanel.jsx` and `ManagedWorktrees.jsx`. Those stabilise callbacks for `useEffect` deps, not for memoized children, so the item's _reasoning_ is intact — but do not re-verify it by grepping for `useCallback`.

---

## Owed elsewhere — real work, but not this repo's code

- **Reconciling the update banner with the template (HTOO-65).** ~~Epona has none.~~ **Shipped 2026-08-08** in PR #38 — but as a **lift**, not a design: `src/main/updateCheck.js` and `components/UpdateSnackbar.jsx` are near-verbatim ports of creidhne's, changing the repo URL and the User-Agent and nothing else. creidhne and corvath grew an update check independently and converged on the same scope, and HTOO-65's call is that a third hand-rolled one gives eleven apps eleven notions of what "newer" means.

  What is **still parked** is the reconciliation. When `hyb-electron-template` adopts one of the two, Epona should _diff_ against it rather than keep its own copy — which is why the port is deliberately faithful. **Trigger:** the template landing an implementation.

  Two divergences are already known and belong upstream, both found by porting rather than by reading: MUI's `Alert` drops its own close button when `action` is passed, so creidhne's banner has no X — which makes its second defect, a clickaway writing the permanent per-version dismissal, the only way out rather than an edge case. Epona fixes both. **Do not quietly re-align to the template on these two** if the template takes creidhne's copy unfixed; fix the template.

- **A Tier-1 design doc.** Epona has no `<app>-design.md` in the document repo (`00-overview.md`, decision 1). It cannot live in this repo, so it can never be a WP here. **Trigger:** a change large enough that its "why" needs settling before its "how" — a second launcher target family, or a rewrite of the instance model.
