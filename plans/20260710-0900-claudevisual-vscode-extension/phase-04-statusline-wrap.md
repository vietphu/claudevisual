# Phase 4 — StatusLine Opt-in Wrap

## Context Links
- Overview: [plan.md](plan.md) · Depends on: [Phase 3](phase-03-hooks-event-log.md) (reuses `installer.ts`/`json-merge.ts`)
- Source: `settings.json` `statusLine` (single object), statusLine stdin payload

## Overview
- **Priority:** High (delivers the precise context%/cost numbers, replacing Phase 1 approximation).
- **Status:** Not Started
- **Description:** Opt-in wrap of the existing `statusLine` command. Never overwrite silently.
  Tee statusline stdin to a cache file, exec the original command untouched, forward stdout. Merge
  precise `context_window.used_percentage` / `cost.total_cost_usd` into `SessionState`.

## Key Insights (verified live)
- `statusLine` is a **single** `{type, command, padding, refreshInterval}` object (NOT an array).
- On this machine it is **already set** to a third-party layer (ClaudeKit:
  `bash $HOME/.claude/hooks/node-hook-runner.sh $HOME/.claude/statusline.cjs`). Only one command can
  be registered → **cannot be overwritten**; must be strictly opt-in **wrap**, never silent replace.
- statusLine stdin payload is rich: `model.{id,display_name}`,
  `cost.{total_cost_usd,total_duration_ms,...}`,
  `context_window.{used_percentage,remaining_percentage,context_window_size,current_usage}`,
  `rate_limits` — the precise source of context%/cost the JSONL baseline only approximates.

## Requirements
**Functional**
- In `installer.ts`, detect current `statusLine.command`:
  - If empty/absent → offer direct install of our own statusline command.
  - If already set → do **not** offer overwrite; offer "Wrap existing statusLine" as a distinct,
    clearly labeled action, plus a "preview wrap" command showing before/after output side-by-side
    before committing.
- `statusline-wrap.cjs`: read stdin JSON once; write it verbatim to
  `~/.claude/claudevisual/statusline-cache.json` (atomic overwrite, single small file); then
  exec/spawn the captured **original** command forwarding the same stdin; pipe its stdout straight
  through unchanged. **Fail-open:** if original errors/missing, still print something non-empty.
- Store `originalCommand` in extension `globalState` (NOT settings.json) so uninstall /
  "Restore Original StatusLine" restores byte-for-byte.
- Extend `event-log-reader.ts` to also tail `statusline-cache.json`, merging precise
  `context_window.used_percentage` / `cost.total_cost_usd` into `SessionState`, replacing the
  Phase-1 approximation when present.

**Non-functional**
- Cache write is a single O(1) small-file atomic overwrite. No blocking, no read-modify-write on hot path.

## Architecture
Data flow:
```
Claude Code statusLine tick ──▶ statusline-wrap.cjs
   ├─▶ atomic-overwrite ~/.claude/claudevisual/statusline-cache.json (verbatim stdin)
   └─▶ exec ORIGINAL command (stdin forwarded) ──▶ stdout piped through unchanged ──▶ Claude Code UI
extension: fs watcher ──▶ event-log-reader (also tails statusline-cache.json)
   ──▶ session-state-store (precise context%/cost overlay, replaces ~approximation)
globalState.originalCommand ──▶ Restore Original StatusLine (byte-for-byte)
```

## Related Code Files
**Create**
- `src/hooks/hook-scripts/statusline-wrap.cjs` — tee stdin to cache, exec original, forward stdout, fail-open.

**Modify**
- `src/hooks/installer.ts` — detect current statusLine; wrap/preview/restore actions; store `originalCommand` in globalState.
- `src/core/event-log-reader.ts` — additionally tail `statusline-cache.json`; merge precise fields.
- `src/core/session-state-store.ts` / `src/core/types.ts` — precise context%/cost fields; prefer precise over approximation.
- `src/ui/status-bar.ts` — drop the `~` prefix when precise value present.
- `package.json` — register Wrap / Preview Wrap / Restore Original StatusLine commands.
- `esbuild.js` — ship `statusline-wrap.cjs`.

**Delete** — none.

## Implementation Steps
1. Implement `statusline-wrap.cjs`: read stdin fully; atomic-overwrite cache file; `spawnSync`/exec original command with same stdin; forward stdout verbatim; on any error print a non-empty fallback line (fail-open).
2. Extend `installer.ts`: read current `statusLine.command`; branch empty vs set; implement Wrap (store `originalCommand` in globalState, set statusLine to our wrap invoking the captured original), Preview Wrap (render before/after side-by-side), Restore (rewrite exact original from globalState via `json-merge.ts` with backup).
3. Extend `event-log-reader.ts` to tail `statusline-cache.json`; parse `context_window`/`cost`; overlay into store.
4. Update `status-bar.ts` to show exact context%/cost (no `~`) when precise present.
5. Register commands; ship script via esbuild.
6. Verify: enable wrap → ClaudeKit statusline renders identically; status bar shows exact numbers; disable → statusLine restored byte-for-byte (diff vs pre-install backup).

## Todo List
- [ ] `statusline-wrap.cjs` (tee + exec original + forward + fail-open)
- [ ] `installer.ts`: detect / Wrap / Preview / Restore (originalCommand in globalState)
- [ ] `event-log-reader.ts`: tail statusline-cache.json + merge precise fields
- [ ] `status-bar.ts`: drop `~` when precise
- [ ] `package.json` commands + esbuild ships script
- [ ] Verify identical ClaudeKit render + exact numbers + byte-for-byte restore

## Success Criteria
Wrapping enabled → the user's existing ClaudeKit statusline renders identically in its normal
location; ClaudeVisual's status bar shows exact context%/cost instead of the approximation; disabling
wrap restores the exact prior `statusLine` value byte-for-byte (verified via diff against the
pre-install backup).

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Wrapper bug visibly breaks user's statusline | Med | High | "Preview wrap" before commit; fail-open fallback; frictionless fast uninstall/restore. |
| Silent overwrite of existing command | Low | High | Never offer overwrite when set; wrap only; store original in globalState + backup. |
| Restore not byte-for-byte | Low | High | Persist exact `originalCommand` in globalState; restore via json-merge with backup; verify by diff. |
| Foreign-process-spawning-foreign-process chain fragility | Med | Med | Forward stdin/stdout untouched; fail-open; keep wrap logic minimal. |
| Cross-platform exec of original (Windows) | Med | Med | Reuse runner.sh/node-locator pattern; flag Windows test pass needed. |

## Security Considerations
- **"Must not slow Claude" gate:** wrap does one atomic small-file overwrite + a passthrough exec of
  the pre-existing command; adds no meaningful latency. Verify explicitly.
- `originalCommand` kept in extension `globalState`, not written into settings.json, so restore is
  authoritative and does not depend on parsing a mutated file.
- Cache file holds statusline payload (model/cost/context metadata) under `~/.claude/claudevisual/`.

## Next Steps
- Feeds precise numbers into Phase 5 charts; Phase 5 config form's statusline-wrap toggle delegates here.
