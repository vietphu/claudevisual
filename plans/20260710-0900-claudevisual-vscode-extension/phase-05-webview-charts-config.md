# Phase 5 — WebviewPanel: Charts + Config-editing Form

## Context Links
- Overview: [plan.md](plan.md) · Depends on: [Phase 1](phase-01-jsonl-baseline.md) (charts),
  [Phase 3](phase-03-hooks-event-log.md) + [Phase 4](phase-04-statusline-wrap.md) (config toggles delegate to those installers)

## Overview
- **Priority:** Medium-High (rich dashboard + the config-editing half of the product's scope).
- **Status:** Not Started
- **Description:** Single WebviewPanel with hand-rolled charts (token/cost/context history) fed by
  incremental diffs, plus a dual-scope config-editing form writing to global and/or project
  settings.json through the shared safe-write path, with diff/confirm + Undo on every write.

## Key Insights
- Config scope is **both** global (`~/.claude/settings.json`) and project
  (`<workspace>/.claude/settings.json`) from v1. Project overrides global. Form must show the
  **effective value + which scope it comes from**, and let the user pick the write scope per field.
- All writes go through `config-writer.ts`, itself built on the same `json-merge.ts` safe
  read-modify-write-with-backup path from Phase 3 — one code path, one set of guarantees.
- Charts fed by **incremental postMessage diffs** from `session-state-store`, not full-history
  resends each tick.
- **OPEN QUESTION (must verify empirically before locking UI copy):** does Claude Code fully
  override or deep-merge project-level settings.json over global, per key? See Open Questions below.

## Requirements
**Functional**
- `panel.ts`: single WebviewPanel, `retainContextWhenHidden`.
- Charts (`charts.ts` + `webview-ui/`): hand-rolled canvas/SVG — token usage over time (stacked
  input/output/cache-read/cache-creation), cost per task/session, context% sparkline.
- Config form fields: default model, effort level, permission `defaultMode`, hooks-install toggle
  (delegates to Phase 3 installer), statusline-wrap toggle (delegates to Phase 4 installer).
- Dual-scope: `settings-paths.ts` resolves both settings.json paths; form shows effective value +
  source scope; user picks write scope per field.
- Every write shows a diff/confirmation toast with an **Undo** action (restores from the backup just
  created) before being considered final.

**Non-functional**
- Incremental diffs to webview (no full-history resend). Writes are O(1) small-file overwrites via json-merge.

## Architecture
Data flow:
```
session-state-store.onDidChange ──▶ panel.postMessage(diff) ──▶ webview-ui (charts render)
config form change ──▶ panel message ──▶ config-writer.ts
   ──▶ settings-paths.ts (resolve global vs project target)
   ──▶ json-merge.ts (backup + atomic write) ──▶ diff/confirm toast (+ Undo → restore backup)
hooks-toggle ──▶ Phase 3 installer.ts   statusline-toggle ──▶ Phase 4 installer.ts
```
Reuses Phase 3 `json-merge.ts` (single safe-write path). Delegates toggles — no duplicate installer logic.

## Related Code Files
**Create**
- `src/ui/webview/panel.ts` — single WebviewPanel, retainContextWhenHidden, message routing.
- `src/ui/webview/charts.ts` — hand-rolled canvas/SVG sparkline/stacked-series helpers (host side).
- `src/ui/webview/config-form.ts` — form model + write orchestration + diff/confirm/Undo.
- `src/ui/webview-ui/main.ts` — webview front-end entry (separate esbuild entry point).
- `src/ui/webview-ui/dashboard.css` — webview styling.
- `src/config/settings-paths.ts` — resolve global vs project settings.json paths + precedence.
- `src/config/settings-schema.ts` — editable field schema (model, effort, defaultMode, toggles).
- `src/config/config-writer.ts` — single code path for every settings.json write (built on json-merge.ts).

**Modify**
- `src/hooks/installer.ts` — expose install/uninstall APIs the toggles call (no duplication).
- `src/core/session-state-store.ts` — emit incremental diffs for webview consumption.
- `package.json` — register `ClaudeVisual: Open Dashboard` command; add second esbuild webview entry.
- `esbuild.js` — add webview-ui entry point bundling.

**Delete** — none.

## Implementation Steps
1. Implement `settings-paths.ts`: resolve `~/.claude/settings.json` + `<workspace>/.claude/settings.json`; compute effective value + source per field.
2. Implement `settings-schema.ts`: field list (default model, effort, `defaultMode`, hooks toggle, statusline toggle) with types/allowed values.
3. Implement `config-writer.ts` on top of `json-merge.ts`: write per-field to chosen scope; return backup handle for Undo.
4. Implement `panel.ts` (single panel, retainContextWhenHidden) + message routing between host and webview.
5. Implement host-side `charts.ts` series builders + `webview-ui/main.ts` + `dashboard.css` rendering stacked token series, cost, context% sparkline from incremental diffs.
6. Implement `config-form.ts`: render effective value + scope; scope picker per field; on submit → config-writer or delegate toggle to Phase 3/4 installer; show diff/confirm toast with Undo (restore backup).
7. Make `session-state-store.ts` emit incremental diffs; wire second esbuild webview entry.
8. **Verify empirically** the settings precedence open question (see below) before finalizing UI copy.
9. Verify: edit "effort level" → reload reflects new value in correct settings.json (diff vs backup); Undo works; charts live-update for an active session.

## Todo List
- [ ] `settings-paths.ts` (global+project resolve, effective value + source)
- [ ] `settings-schema.ts`
- [ ] `config-writer.ts` (on json-merge.ts, returns backup handle)
- [ ] `panel.ts` (single panel, retainContextWhenHidden)
- [ ] `charts.ts` + `webview-ui/main.ts` + `dashboard.css`
- [ ] `config-form.ts` (scope picker, diff/confirm, Undo)
- [ ] store incremental diffs + second esbuild entry
- [ ] EMPIRICAL: verify settings precedence (override vs deep-merge)
- [ ] Verify effort-edit round-trip + Undo + live charts

## Success Criteria
Editing "effort level" in the form and reloading reflects the new value in the correct settings.json
(verified against a backup diff), Undo works, and the chart panel shows live-updating token/cost
history for an active session.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Wrong-scope write (global vs project) | Med | High | `settings-paths.ts` resolves both; explicit per-field scope picker; diff/confirm before final. |
| Config write corrupts settings.json | Low | High | All writes via json-merge.ts: backup + atomic write-then-rollback; Undo restores backup. |
| Full-history resend to webview (perf) | Med | Med | Incremental postMessage diffs only. |
| Duplicating installer logic in form | Med | Med | Toggles delegate to Phase 3/4 installer APIs (DRY). |
| UI copy wrong re: precedence semantics | Med | Med | Verify empirically (open question) before locking copy. |

## Security Considerations
- **"Must not slow Claude" gate:** config writes are O(1) small-file overwrites via json-merge; no
  hot-path read-modify-write. Verify explicitly for each new I/O surface added here.
- Every write is backed up before mutation and reversible via Undo.
- Confirm/diff toast prevents silent config changes; scope shown so the user knows which file is edited.

## Open Questions
- **Settings precedence (blocker for UI copy):** Does Claude Code fully override or deep-merge
  project-level settings.json over global, per key? Verify: create a test project-level settings.json
  with one overriding key, launch a real Claude Code session, observe actual precedence. Do not assume.

## Next Steps
- Completes v1 feature surface. Feeds Phase 6 (config-write + Undo covered by json-merge tests + manual checklist).
