---
phase: 4
title: "Nesting + Extras"
status: completed
priority: P3
effort: "1-2d (optional / incremental)"
dependencies: [3]
---

# Phase 4: Nesting + Extras

## Outcome (implemented)

- **Nesting** ✅ — **redesigned after real-data verification found the original
  approach didn't work.** The original implementation reconstructed parent→child
  from `SubAgentState.childAgentIds`, assuming a spawning `Task` tool_use block's
  `id` equals the child's transcript-filename agentId. Spawning a real nested run
  and inspecting the actual files on disk (per this phase's own risk-assessment
  gate) showed that assumption is false: (a) the spawn tool is named `Agent`, not
  `Task`, in real transcripts; (b) each sub-agent has an `agent-<agentId>.meta.json`
  sidecar (`toolUseId`, `agentType`, `description`, `parentAgentId`) that the
  code never read, and the spawning tool_use's `id` is a distinct `toolu_...`
  string unrelated to the filename agentId. Under the old code every real spawn
  produced two split ghost rows (one with the right type but 0 tokens, one with
  real tokens but type stuck `"unknown"`), and nesting never matched.
  Redesigned around the meta sidecar: `core/subagent-meta-reader.ts` reads it,
  `core/subagent-file-registry.ts` (split out of `jsonl-tailer.ts`) discovers it
  and fires `onSubagentMeta`, `applySubagentMetaOverlay` in
  `session-state-overlays.ts` is the sole source of a sub-agent's type, spawn
  reason, `parentAgentId`, and `toolUseId` (also used to match its later
  `tool_result` and flip `status` to `completed`, replacing the same broken
  id-matching there). `core/agent-tree.ts` now groups by each agent's own
  `parentAgentId` (bottom-up) instead of scanning transcript content for nested
  spawns (top-down) — simpler and, per the real-data run, actually correct.
  Verified end-to-end against a real nested run's on-disk transcripts +
  `.meta.json` files (not just fixtures): correct type, correct token totals, no
  duplicate entries, correct parent/child tree.
- **Burn-rate** ✅ — `src/core/token-burn.ts` (bounded sample ring + tokens/min)
  sampled by the store on its debounced tick; shown as `~NK/min` in vitals, `—`
  before the second sample / when idle (stale).
- **Progress** ✅ — honest `N calls` chip on running agents (observed tool-call
  count), never a fabricated percentage.
- **Queued agents** ⛔ DROPPED as out-of-scope — hook/transcript data only shows
  agents *after* spawn; the only "planned" source would be a plan/todo file,
  which is fabrication-prone and not reliably present. Per the risk assessment
  below, not shipped rather than shown as invented data; the mockup's queued rows
  are not rendered.

## Overview

The harder, lower-certainty features, each independently shippable: agent-tree **nesting**
(planner → researcher), **queued-agent** display, **burn-rate** sampling, and per-agent
**progress**. None block the core redesign (Phases 1–3 deliver the full visual value). Sequence by
value; drop any that prove not worth the complexity.

## Requirements

- Functional (each optional): (a) tree renders true parent→child nesting; (b) not-yet-started agents
  from the active plan show as "queued"; (c) vitals shows a token burn-rate; (d) the running agent
  shows a progress indicator.
- Non-functional: no new hot-path cost; every feature fails open and is individually toggleable.

## Architecture

**Nesting (hardest — verified constraint).** Subagent transcript lines carry `agentId`, `sessionId`,
`isSidechain`, `parentUuid`, `uuid` — but **no `parentAgentId`**. Parent→child is therefore NOT
directly available. Reconstruct it: when Phase 3 parses a subagent transcript's `tool_use` blocks,
any `Task` block found there spawns a child whose tool_use `id` == the child's `agentId`. Build a
`parentId → childIds` map from those in-transcript Task blocks; the top level (children of the main
session) are the Task blocks in the main transcript. Render `subagents` as a tree instead of a flat
list.

- Depends on Phase 3 (subagent-content parsing) — do not attempt before it.
- Edge cases: a child transcript may appear before its parent's Task line is parsed (out-of-order
  tails) → hold orphans in a pending map, attach on parent arrival; render orphans at root until then.
- Verify against a real nested run (this repo's own `planner` spawns `researcher`s — reproduce and
  inspect `subagents/` for the nested Task ids).

**Queued agents.** Hook/transcript data only shows agents *after* spawn. "Queued" must come from the
active plan's todo/phase list (the `## Plan Context` the workflow already surfaces, or a plan file's
phases). Treat as a separate, clearly-labelled "planned" overlay — never conflate with observed
agents. Ship only if a clean plan source exists; otherwise document as not-supported and drop the
mockup's queued rows.

**Burn-rate.** Sample `cumulativeUsage.total` on a timer (e.g. every 15–30s) into a tiny bounded ring
in the store; rate = Δtokens / Δt over the last window. Display `~NK/min` in vitals. Cheap, but the
first sample has no rate (show "—").

**Per-agent progress.** No ground-truth progress signal exists. Approximate from tool-call count vs a
rolling max, or from the parent's TodoWrite state if attributable. Label explicitly as approximate;
prefer showing "N calls · running" over a fake percentage if the estimate is too noisy.

## Related Code Files

- Modify: `src/ui/webview-view/session-view-model.ts` (tree structure, queued overlay, burn-rate,
  progress), `src/ui/webview-view-ui/render-agents.ts` (nested rendering)
- Create: `src/core/agent-tree.ts` (flat subagents + in-transcript Task links → nested tree; pure,
  testable)
- Modify: `src/core/session-state-store.ts` (burn-rate sample ring)
- Maybe: `src/core/plan-context.ts` (read active plan phases for queued overlay) — only if pursued

## Implementation Steps

1. **Nesting:** write `agent-tree.ts` (pure: `(subagents, taskLinks) → AgentTreeNode[]`) with
   orphan-hold handling; unit-test with fixtures incl. out-of-order arrival. Wire nested render.
2. Verify nesting on a real `planner → researcher` run; confirm the tree matches `subagents/`.
3. **Burn-rate:** add sample ring + rate calc; render in vitals.
4. **Progress:** add approximate indicator to the running agent; label as estimate.
5. **Queued (conditional):** if a clean plan source exists, add the planned overlay; else document
   as dropped.
6. `npm run reinstall`; verify each feature independently; update `docs/` + changelog.

## Success Criteria

- [x] Nesting: a real nested run renders nested, matching the on-disk `subagents/` structure +
      `.meta.json` sidecars; out-of-order tails don't misparent (unit tests + a real-transcript
      verification script both cover it — see Outcome above).
- [x] Burn-rate shows a plausible `~NK/min` after the second sample; "—" before (unit-tested).
- [x] Progress indicator is present on the running agent and clearly labelled approximate (`N calls`).
- [x] Queued overlay is documented as out-of-scope with the mockup rows removed — no fabricated data.
- [x] Each feature fails open independently; files < 200 lines (all new/changed files in this phase;
      `jsonl-tailer.ts` and `event-log-reader.ts` remain over 200 — pre-existing, reduced but not
      eliminated as a side effect); typecheck + tests green (137 passing).

## Risk Assessment

- **Nesting correctness** is the main risk — the reconstruction is indirect. Gate on the real-run
  verification; if it proves unreliable, ship the flat list (Phase 1) and mark nesting deferred. Do
  NOT invent parent links.
- **Queued = fabrication risk** — the strongest temptation to show data that isn't observed. Only
  render it from a real plan/todo source, explicitly labelled "planned", never mixed with observed
  agents.
- **Progress = vanity-metric risk** — a fake percentage misleads. Prefer honest "N calls · running"
  over a precise-looking guess.
