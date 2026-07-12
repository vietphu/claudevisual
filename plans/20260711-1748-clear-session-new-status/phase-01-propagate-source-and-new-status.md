# Phase 01 — Propagate `source` + render "new" status

## Context Links

- Overview: [plan.md](plan.md)
- Emit hop: `src/hooks/hook-scripts/emit-event.cjs:38-58`
- Parse hop: `src/core/hook-event-parsing.ts:11-19` (interface), `:64-85` (parser)
- Overlay hop: `src/core/session-state-overlays.ts:14-24`
- State shape: `src/core/types.ts:28-118` (`SessionState`), `:120-146` (`emptySessionState`)
- View-model DTO: `src/ui/webview-view/sidebar-messages.ts:128-170`
- View-model transform: `src/ui/webview-view/session-view-model.ts:31-66`
- Render: `src/ui/webview-view-ui/render-vitals.ts:40-53`
- Status dot CSS: `src/ui/webview-view-ui/sidebar.css:124-126`

## Overview

- **Priority:** P2 (required — this is the core fix)
- **Status:** done
- **Description:** Carry Claude Code's `SessionStart.source` from the hook
  payload all the way to the sidebar, and use it to render a freshly-started
  session (no real activity yet) with a distinct **"new"** status instead of
  the ambiguous "idle"/"live".

## Key Insights

- `source` only ever arrives on a `SessionStart` hook event; every other event
  has no `source`. The overlay must therefore only set the field on
  `SessionStart`, and preserve the prior value otherwise.
- No need to *clear* the field on later activity: the render gate ("no tokens /
  no tool calls / no title") naturally stops showing "new" once work begins, so
  the overlay stays a pure, monotonic carry — simpler and race-tolerant, matching
  the existing `lastHookEvent` handling.
- `source` is only present when opt-in hooks are installed. That is precisely
  when the confusing empty card appears (`SessionStart` fires immediately on
  `/clear`), so the fix lands exactly where it is needed; without hooks nothing
  regresses.

## Requirements

**Functional**
- A session started via `source: "clear"` (or `"startup"`) that has zero tokens,
  zero tool calls, zero sub-agents, and no `ai-title` yet renders status label
  **"new"** with a distinct dot, not "idle"/"live".
- Once such a session records any real activity, it renders normally
  (running/live/idle) exactly as today.
- `source: "resume"` and `source: "compact"` do NOT show "new" (they continue
  prior work / context) — only `clear` and `startup` qualify.

**Non-functional**
- Zero added I/O; piggybacks the existing NDJSON append + tailer pipeline
  (README "Hard constraint" unaffected).
- All new branching logic in vscode-free pure functions.

## Architecture

Data flow (one new field threaded along the existing overlay path):

```
Claude Code SessionStart payload
  payload.source  ─┐
                   ▼
emit-event.cjs buildRecord()        → record.source           (NDJSON line)
                   ▼
hook-event-parsing parseHookEventLine → HookEventRecord.source (validated string)
                   ▼
session-state-overlays applyHookEventOverlay
   sets SessionState.lastSessionStartSource  ONLY when hookEvent==="SessionStart"
                   ▼
session-view-model toSessionViewModel → SessionViewModel.sessionStartSource
                   ▼
render-vitals: if sessionStartSource ∈ {clear,startup} AND no real activity
   → dotClass="dot new", statusLabel="new"
```

## Related Code Files

**Modify**
- `src/hooks/hook-scripts/emit-event.cjs` — capture `payload.source`.
- `src/core/hook-event-parsing.ts` — add `source?: string` to `HookEventRecord`
  + parse/validate in `parseHookEventLine`; update the JSDoc "keep in sync" note.
- `src/core/session-state-overlays.ts` — set `lastSessionStartSource` in
  `applyHookEventOverlay`.
- `src/core/types.ts` — add `lastSessionStartSource: string | undefined` to
  `SessionState` + `emptySessionState`.
- `src/ui/webview-view/sidebar-messages.ts` — add `sessionStartSource?: string`
  to `SessionViewModel`.
- `src/ui/webview-view/session-view-model.ts` — pass
  `state.lastSessionStartSource` through in `toSessionViewModel`.
- `src/ui/webview-view-ui/render-vitals.ts` — compute the "new" dot/label.
- `src/ui/webview-view-ui/sidebar.css` — add `.dot.new` rule.

**Create:** none.
**Delete:** none.

## Implementation Steps

1. **emit-event.cjs** (`buildRecord`, after the `permission_mode` block):
   ```js
   if (typeof payload.source === "string") {
     record.source = payload.source;
   }
   ```

2. **hook-event-parsing.ts**
   - Add `source?: string;` to `HookEventRecord` (after `permissionMode`).
   - In `parseHookEventLine`'s return object add:
     `source: typeof parsed.source === "string" ? parsed.source : undefined,`
   - Leave `SessionStart` in `IDLE_HOOK_EVENTS` unchanged — a fresh session is
     genuinely not "running"; the "new" distinction is a display concern layered
     on top of the running/idle bit, not a replacement for it.

3. **types.ts**
   - Add to `SessionState` (near `lastHookEvent`), with a short WHY-JSDoc:
     ```ts
     /** `source` of the most recent `SessionStart` hook event
      *  ("startup" | "resume" | "clear" | "compact"), if hooks are installed.
      *  Lets the sidebar tell a just-`/clear`-ed (or just-started) empty session
      *  apart from one that did work and went quiet. */
     lastSessionStartSource: string | undefined;
     ```
   - Add `lastSessionStartSource: undefined` to `emptySessionState`.

4. **session-state-overlays.ts** (`applyHookEventOverlay` return object):
   ```ts
   lastSessionStartSource:
     record.hookEvent === "SessionStart" && record.source
       ? record.source
       : base.lastSessionStartSource,
   ```
   Placed alongside the existing `lastHookEvent` carry; keeps the function pure
   and preserves prior value on non-SessionStart events.

5. **sidebar-messages.ts** — add to `SessionViewModel` (near `title`):
   `/** `source` of the latest SessionStart hook event, when hooks installed. */`
   `sessionStartSource?: string;`

6. **session-view-model.ts** — in `toSessionViewModel`'s returned object add:
   `sessionStartSource: state.lastSessionStartSource,`

7. **render-vitals.ts** — replace the dot/label lines (41-42) with a
   fresh-session-aware version:
   ```ts
   const hasActivity =
     s.totalTokens > 0 || s.agents.length > 0 || s.feed.length > 0 || !!s.title;
   const isFresh =
     !hasActivity && (s.sessionStartSource === "clear" || s.sessionStartSource === "startup");
   const dotClass = isFresh
     ? "dot new"
     : s.running ? "dot running" : s.live ? "dot live" : "dot idle";
   const statusLabel = isFresh
     ? "new"
     : s.running ? "working" : s.live ? "live" : "idle";
   ```
   `statusLabel` already flows into the subtitle (lines 50-53) and the dot's
   `title` attribute — no other change needed there.

8. **sidebar.css** — after `.dot.idle` (line 126) add a distinct, non-pulsing
   rule, e.g.:
   ```css
   .dot.new { background: var(--accent, var(--good)); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent, var(--good)) 30%, transparent); }
   ```
   Pick a token already defined in the sheet; goal is "visibly not grey-idle",
   not a new pulse animation.

9. **Typecheck:** `npm run typecheck` — resolve any type errors before handing to
   Phase 3.

## Todo List

- [ ] emit-event.cjs captures `payload.source`
- [ ] `HookEventRecord.source` added + parsed/validated
- [ ] `SessionState.lastSessionStartSource` added to type + `emptySessionState`
- [ ] `applyHookEventOverlay` sets it only on `SessionStart`
- [ ] `SessionViewModel.sessionStartSource` added + passed through
- [ ] `render-vitals` renders "new" dot/label under the activity gate
- [ ] `.dot.new` CSS rule added
- [ ] `npm run typecheck` clean

## Success Criteria

- A `/clear`-started session with no activity shows a "new" dot + "new" in the
  subtitle; the same session shows normal status after its first prompt.
- `resume`/`compact` sessions never show "new".
- Sessions on machines without hooks installed render exactly as before.
- `npm run typecheck` passes.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| `source` absent (no hooks) → "new" never shows | High | Low | By design; degrades to today's behavior, no regression. |
| A resumed/compacted session momentarily has no activity and flashes "new" | Low | Low | Gate excludes `resume`/`compact`; only `clear`/`startup` qualify. |
| `hasActivity` misjudged (e.g. title arrives before tokens) | Low | Low | Gate ORs four independent signals; any one flips it out of "new". |
| `.dot.new` uses an undefined CSS var | Low | Low | Reuse a token already present in `sidebar.css`; verify visually. |
| Overlay overwrites `lastSessionStartSource` with stale value | Low | Med | Only `SessionStart` events with a truthy `source` write it; else prior value preserved. |

## Security Considerations

- `source` is a short enum-like string from a trusted local hook payload; treated
  as opaque text, only compared against literals — no injection surface (rendered
  via existing `esc()` path in the subtitle).

## Next Steps

- Phase 3 (required): unit tests for the touched pure functions + regression run.
- Phase 2 (optional): "cleared from <prev>" continuity hint, if it fits cleanly.
