---
phase: 3
title: "Drill-down + Heartbeat"
status: pending
priority: P2
effort: "1-1.5d"
dependencies: [1, 2]
---

# Phase 3: Drill-down + Heartbeat

## Overview

Two interaction-rich features: (1) click an agent to **drill into** its own tool calls + files, and
(2) an **activity heartbeat** — a time-axis strip of colored bars, each colored by the agent active
at that moment. Both need per-agent tool-call data the reducer currently discards, and real
timestamps from the event log / subagent transcript lines.

## Requirements

- Functional: clicking any agent node expands an inline panel listing that agent's recent tool calls
  (name + detail + time) and the files it touched. A heartbeat strip renders one bar per recent
  event across a real time axis, colored by agent identity (shared color map from Phase 1),
  reflecting parallel work (overlapping agents interleave).
- Non-functional: per-agent ring buffer bounded (like the existing `MAX_RECENT_TOOL_CALLS = 20`);
  heartbeat degrades to "unavailable" when the event log is absent (hooks not installed); no
  additional file re-reads beyond the tails already running.

## Architecture

**Per-agent tool calls (drill-down):**

- Extend `reduceSubAgentLine` ([state-reducer.ts](../../src/core/state-reducer.ts)) — currently it
  only reads `message.usage`. Also scan `message.content` for `tool_use` blocks (reuse the existing
  `extractToolUseBlocks` + `extractToolCallDetail` + `pushRecentToolCall` helpers) into a new
  `SubAgentState.recentToolCalls: ToolCallRecord[]` bounded ring buffer.
- Files-touched per agent = derive in the view-model by filtering that agent's `recentToolCalls`
  where `name ∈ {Edit, Write, Read, MultiEdit}` and `detail` looks like a path.
- Subagent transcript lines carry a real `timestamp` (verified) — use it for `ToolCallRecord.timestamp`
  in the subagent path (instead of `Date.now()`), so drill-down + heartbeat show true times.

**Heartbeat:**

- Source = the events NDJSON log via [event-log-reader.ts](../../src/core/event-log-reader.ts),
  which already emits `HookEventRecord { ts, sessionId, toolName, agentId, hookEvent }`. Maintain a
  bounded per-session event ring (e.g. last 60 `PreToolUse`/`PostToolUse` events) in the store, keyed
  for the heartbeat. Each bar's color = `agentColor(agentId ?? 'main')`.
- Fallback when hooks absent: derive an approximate heartbeat from `recentToolCalls` timestamps
  (main-session only, parse-time), or hide the strip with a "install hooks for live timeline" hint.

**Store + view-model:** the event ring lives in `SessionStateStore` (fed by the existing
`EventLogReader.onEvent` subscription — confirm it is wired; add if only the running-bit is consumed
today). View-model gains `heartbeat: {t, agentColorIndex}[]` and `agents[].detail`.

**Client:** `render-heartbeat.ts` (bars), and extend `render-agents.ts` with the collapsible
drill-down; wire the `toggleAgent` message stubbed in Phase 1 (client-only toggle — no host round
trip needed since detail ships in the view-model).

## Related Code Files

- Modify: `src/core/types.ts` (`SubAgentState.recentToolCalls`; event-ring type),
  `src/core/state-reducer.ts` (parse subagent tool_use blocks + real timestamp)
- Modify: `src/core/session-state-store.ts` (maintain per-session event ring from
  `EventLogReader.onEvent`)
- Modify: `src/ui/webview-view/session-view-model.ts` (agent detail + heartbeat series)
- Create: `src/ui/webview-view-ui/render-heartbeat.ts`; extend `render-agents.ts`
- Reference: `src/core/event-log-reader.ts` (`HookEventRecord`, `onEvent`)

## Implementation Steps

1. Add `recentToolCalls` to `SubAgentState`; extend `reduceSubAgentLine` to push tool_use blocks
   with the line's real `timestamp`. Unit-test with a subagent fixture containing tool_use blocks.
2. Confirm/add `EventLogReader.onEvent` → store subscription; maintain a bounded per-session event
   ring. Unit-test the ring (bound, ordering, per-session keying).
3. Extend view-model: agent `detail` (calls + files) and `heartbeat` series with color indices.
4. Client: `render-heartbeat.ts`; collapsible agent drill-down in `render-agents.ts` (caret + panel,
   matching mockup). Reduced-motion friendly.
5. Fallback path: heartbeat hint when event log absent; verify no error on missing dir.
6. `npm run reinstall`; verify drill-down + heartbeat on a real multi-agent session with hooks
   installed, and again with hooks NOT installed (fallback).

## Success Criteria

- [ ] Clicking an agent reveals its real tool calls + files-touched; times are true (not parse-time)
      for subagents.
- [ ] Heartbeat renders real-time-ordered bars colored by agent; parallel agents visibly interleave.
- [ ] With hooks uninstalled, heartbeat shows the fallback/hint and nothing throws.
- [ ] Per-agent + event rings are bounded (no unbounded memory growth on long sessions).
- [ ] New unit tests for subagent tool-call parsing + event ring; existing tests green.
- [ ] Files < 200 lines; typecheck clean.

## Risk Assessment

- **Event/transcript ordering skew** — event log (hook time) and transcript (`timestamp`) are
  near-but-not-identical clocks. Pick ONE source per surface (heartbeat = event log; drill-down times
  = transcript) and don't interleave them on the same axis.
- **Store coupling** — adding an event ring to the store risks bloating it. Keep the ring a separate
  bounded structure; don't fold events into `SessionState` per-line reducers.
- **Perf** — subagent content parsing runs per appended line; the tool_use scan is already O(blocks
  per line). Confirm no full-transcript re-scan is introduced.
