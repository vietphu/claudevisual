---
title: "Distinguish /clear-started sessions from idle-after-work"
description: "Propagate SessionStart source through the pipeline; render a fresh session as 'new', not 'idle'."
status: done
priority: P2
effort: 3h
branch: main
tags: [sidebar, hooks, session-state, ux]
created: 2026-07-11
---

## Problem

After `/clear`, Claude Code starts a fresh session (new session_id, new JSONL).
ClaudeVisual's sidebar renders it identically to a session that did real work
then went quiet: title falls back to the cwd basename, status shows plain
"idle", every stat is zero. Users read this as "my previous session vanished"
when it is merely sorted below and collapsed.

## Root cause (verified)

Claude Code's `SessionStart` hook payload carries a `source` field
(`"startup" | "resume" | "clear" | "compact"`) explaining *why* the session
started, but the signal is dropped at the first hop —
`emit-event.cjs::buildRecord` (`src/hooks/hook-scripts/emit-event.cjs:38-58`)
never captures `payload.source`, so nothing downstream can tell a `/clear`
session apart from any other quiet one. `SessionStart` is also in
`IDLE_HOOK_EVENTS` (`src/core/hook-event-parsing.ts:41`), so a fresh session
immediately reads as generic "idle".

## Fix (agreed scope — do not expand)

Propagate `source` end-to-end and use it to render a freshly-started session
(no tokens / no tool calls / no title yet) with a distinct **"new"** status
instead of "idle". Optional stretch: a "cleared from <prev>" continuity hint.

## Phases

| # | Phase | Status | Required | Depends on |
|---|-------|--------|----------|-----------|
| 1 | [Propagate `source` + render "new" status](phase-01-propagate-source-and-new-status.md) | done | Yes | — |
| 2 | [Optional: "cleared from" continuity hint](phase-02-cleared-from-continuity-hint.md) | done | No (deferrable) | Phase 1 |
| 3 | [Unit tests + regression run](phase-03-tests-and-regression.md) | done | Yes | Phase 1 (and 2 if built) |

## Key dependencies

- Phase 1 is the whole required fix; Phases 2 and 3 build on its new fields.
- Phase 2 is explicitly cuttable — if it needs nontrivial new architecture it
  is dropped, not allowed to block Phase 1 or 3.
- `source` is only observable when the opt-in hooks are installed (that is also
  exactly when the confusing empty card appears — `SessionStart` fires
  immediately). Without hooks, behavior is unchanged (graceful degradation).

## Constraints honored

- Files stay under ~200 lines (each touched file grows by a few lines only).
- New logic lives in the vscode-free pure modules (`hook-event-parsing.ts`,
  `session-state-overlays.ts`, `render-vitals.ts`, `session-view-model.ts`) so
  it is unit-testable without the extension host.
- No comments explaining WHAT; only non-obvious WHY, matching the file-level
  JSDoc style already in these files.
- Out of scope (explicitly deferred, not part of this fix): session pruning,
  auto-collapse changes, TreeView.
