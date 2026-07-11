# Session title in sidebar (from `ai-title` transcript line)

## Problem

Sidebar session cards show `basename(cwd)` as the name (`render-vitals.ts:39`).
Multiple concurrent sessions in the same project all render the identical
name, leaving only the 8-char `shortId` hash to tell them apart — not enough
to distinguish "which session is doing what" at a glance.

## Approach

Claude Code already writes its own auto-generated session title to the
transcript as a distinct line type: `{"type":"ai-title","sessionId":"...",
"aiTitle":"..."}` (verified against real transcripts under
`~/.claude/projects/-Users-dinhphu-Desktop-ClaudeVisual/`). It recurs every
~20-30 lines through the session (re-written as the conversation evolves),
so it reliably falls inside the tailer's `PRIME_TAIL_BYTES` backfill window
even for sessions the extension attaches to mid-conversation.

Parse this line type and store the latest value as `SessionState.title`;
display it in place of the cwd basename, falling back to the basename when
no title has been seen yet (session just started, or hooks/title-gen hasn't
fired). No new I/O — piggybacks on the existing tailer/reducer pipeline, so
the "never slow down Claude Code" constraint (README.md "Hard constraint")
is unaffected.

## Changes

- `src/core/types.ts` — add `title: string | undefined` to `SessionState` +
  `emptySessionState`.
- `src/core/state-reducer.ts` — new `case "ai-title"` branch reading
  `line.raw.aiTitle`, mirroring the existing `reduceMode` pattern.
- `src/ui/webview-view/sidebar-messages.ts` — add `title?: string` to
  `SessionViewModel`.
- `src/ui/webview-view/session-view-model.ts` — pass `state.title` through.
- `src/ui/webview-view-ui/render-vitals.ts` — prefer `s.title` over
  `basename(s.cwd)`; keep the basename as fallback and keep `cwd` in the
  `title=` hover attribute for the full path.

## Out of scope

- No manual rename/pin UI (title is purely derived, not user-editable).
- No change to the TreeView (`ui/tree-view/*`) — this pass only covers the
  sidebar webview vitals header, which is where the ambiguity was reported.
