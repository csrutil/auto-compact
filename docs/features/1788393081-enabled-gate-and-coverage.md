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

## Final Result

Filled in after validation.

## Review

### 1788393081 — tsaokoming — glm-5p3-flash — max

Filled in after review.
