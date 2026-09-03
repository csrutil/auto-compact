# Honor `compaction.enabled` and Close Priority Test Gaps

## Goal

1. `compaction.enabled: false` currently leaves the extension fully active:
   pi's `compact()` never reads `enabled` (only pi's `shouldCompact()` does,
   gating pi's own auto-compaction), so the extension's background trigger
   and manual-compaction interception run despite the user disabling
   compaction. Fix: `enabled: false` makes the extension fully inert —
   it registers no handlers and Pi's standard compaction behavior applies.
2. Module-level `settings.compaction` destructure crashes extension load
   with an opaque TypeError when the section is missing. Fix: fail with a
   clear error naming the missing section.
3. `session_before_compact` clears `job` unconditionally after awaiting the
   cached promise; if a newer job started during the await, its tracking is
   lost. Fix: clear only when the awaited job is still current.
4. Close the four highest-value coverage gaps found by the ablation study
   (docs/features/1788360940-ablation-study.md): threshold gate, settled
   leaf-moved guard, cache-usable gate, pending-response rejection — plus
   the partitions the new fixes introduce.

## Plan

### 1788393081 — tsaokoming — glm-5p3-flash — max

- `extensions/compact.ts`: guard missing `compaction` section with a clear
  error; destructure `enabled` out of the settings rest; early-return from
  the extension registration when disabled; clear `job` after cache use
  only when still current (`job === cachedJob`).
- New tests drive the real handlers with stubbed `ctx` (no network): the
  background path runs pi's real `compact()` with a stubbed
  `modelRegistry.complete`, so assertions exercise real logic.
  - `test/background.test.mjs` (fixture: small `keepRecentTokens`):
    threshold gate, job start notify, settled leaf guard (both arms),
    cache hit reuse + job clearing, pending-response rejection, foreground
    fallback on custom instructions and on branch mismatch.
  - `test/disabled.test.mjs` (fixture: `enabled: false`): no handlers
    registered.
  - `test/settings-guard.test.mjs` (fixture: no `compaction` section):
    import rejects with the clear error.
- README: document that `enabled: false` disables this extension.
- Validation: `npm run check`, then re-run the ablation matrix against the
  new suite and confirm the covered partitions are now detected.

## Work Log

### 1788393081 — tsaokoming — glm-5p3-flash — max

Implemented the enabled gate, settings guard, and race guard in
`extensions/compact.ts`; added the three test files and fixtures; updated
README.

Reason: `enabled` was forwarded to pi's `compact()` which never reads it —
verified against pi-coding-agent 0.84.4 source (`shouldCompact` at
compaction.js:161 is the only `enabled` consumer). The race guard is
defensive; it has no dedicated async-interleaving test (proof gap noted
below).

Checks: filled in after validation runs.

### 1788397000 — tsaokoming — glm-5p3-flash — max

Revision after review: the missing-section guard no longer throws. A throw
during extension load interrupts the agent flow, so an unconfigured or
disabled state now degrades to a `ctx.ui.notify` notice on `session_start`
(`auto-compact inactive: <reason>`) and registers no compaction handlers.
Also replaced the module-level UPPER_CASE constants with a lowercase
`compaction` object (`DEFAULT_COMPACTION_SETTINGS` layered under the user's
`settings.compaction`, read directly per review feedback), and
`prepareBackgroundCompaction` now takes its settings as a parameter.

Reason: throwing at import makes load failures crash the user's agent
session; a notice keeps the agent usable and tells the user what to fix.

Checks: `npm run check` green (13 tests). Full ablation matrix re-run
(54 partitions): 22 detected / 32 gap. Newly detected: inactive-gate,
inactive-notice, model-unavailable-throw, cache-branch-contains,
timing-drop, duration-value, settings-drop, done-stream-mapping.
Known proof gaps: `race-guard` (needs a mid-await interleaving harness),
`default-thinking-level` (fixture pins `thinkingLevel`), and the partitions
listed in the previous ablation study document that were not in scope here.

## Final Result

- `compaction.enabled: false` (or missing provider/model/threshold) now
  makes the extension fully inert: it registers only a `session_start`
  handler that notifies `auto-compact inactive: <reason>` via
  `ctx.ui.notify`; Pi's standard compaction behavior applies.
- Missing `compaction` section no longer crashes extension load.
- `session_before_compact` clears the consumed job only when it is still
  current (`job === cachedJob`).
- Suite grew 2 → 13 tests; ablation coverage 7 → 22 of 54 partitions.
  Remaining gaps are recorded in
  docs/features/1788360940-ablation-study.md and the work log above.

## Review

### 1788397000 — tsaokoming — glm-5p3-flash — max

Final review: implementation reviewed, checks passed, regressions checked,
diff reviewed.
Result: PASS
