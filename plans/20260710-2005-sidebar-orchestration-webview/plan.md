---
title: ClaudeVisual — sidebar orchestration webview redesign
description: >-
  Replace the flat native TreeView sidebar with a rich, theme-aware WebviewView
  that visualizes agent orchestration: tree with per-agent model/tokens/status,
  token+cache economics, activity heartbeat, feed, and files-touched.
status: pending
priority: P2
branch: main
tags:
  - vscode-extension
  - webview
  - orchestration
  - observability
  - ui-redesign
blockedBy: []
blocks: []
related:
  - 20260710-0900-claudevisual-vscode-extension
created: '2026-07-10T13:06:33.279Z'
createdBy: 'ck:plan'
source: skill
---

# ClaudeVisual — sidebar orchestration webview redesign

## Overview

Redesign the ClaudeVisual sidebar from a flat native `TreeView`
([session-tree-provider.ts](../../src/ui/tree-view/session-tree-provider.ts)) into a rich
`WebviewView` that makes **agent orchestration** the centerpiece: a linked agent tree (parent →
child, parallel siblings, live status), per-agent model/tokens/duration, token + cache economics,
an activity heartbeat colored by agent identity, a tool-call feed with spawn events, and a
files-touched panel. Approved design mockup: `scratchpad/claudevisual-sidebar-mockup.html`
(published artifact, dense/pro, light+dark theme-aware).

**Why a webview:** `TreeView` cannot render the rings, bars, stacked economics, colored heartbeat,
or drill-down interactions the design needs. The extension already ships webview infra from the
prior plan's Phase 5 ([panel.ts](../../src/ui/webview/panel.ts),
[webview-ui/](../../src/ui/webview-ui/), [vscode-api.ts](../../src/ui/webview-ui/vscode-api.ts)) —
this reuses those patterns for a *view* (sidebar) instead of a *panel*.

**Relationship to prior plan:** continues `20260710-0900-claudevisual-vscode-extension` (status:
implemented). This **supersedes that plan's Phase 2** (native TreeView sidebar) and **reuses its
Phase 3/4/5** data plumbing (event log, statusline cache, webview message-passing). No blocking
dependency — the prior plan is done.

## Hard constraints (inherited + new)

- **Never slow down Claude Code.** All new reads stay O(1)-appended-bytes or small-file overwrite;
  no read-modify-write on hot paths. (Inherited from prior plan.)
- **Fail open on missing data.** Hooks + statusline wrap are opt-in; `events-*.ndjson` and
  `statusline-cache.json` may be absent. Every section degrades gracefully (JSONL-derived fallback
  or hidden), never errors.
- **Theme-aware.** Token-based CSS; works in VS Code light + dark. Use `var(--vscode-*)` where it
  reads native, custom tokens for the accent/agent-identity system.
- **Files < 200 lines.** Modularize per repo CLAUDE.md — split renderers, state serialization, and
  the webview client into focused kebab-case modules.
- **Shared agent-identity color system.** One deterministic agentId → color map, used identically
  across tree, heartbeat, feed, and files.

## Phases

| Phase | Name | Status | Depends on | Risk |
|-------|------|--------|-----------|------|
| 1 | [Webview Shell](./phase-01-webview-shell.md) | ✅ Completed (code; live-verify pending) | — | Low |
| 2 | [Reducer + Economics](./phase-02-reducer-economics.md) | ✅ Completed (code; live-verify pending) | 1 | Low |
| 3 | [Drill-down + Heartbeat](./phase-03-drill-down-heartbeat.md) | ✅ Completed (code; live-verify pending) | 1, 2 | Medium |
| 4 | [Nesting + Extras](./phase-04-nesting-extras.md) | ✅ Completed — nesting redesigned + verified against real transcripts after the original approach proved broken (code; visual UI live-verify pending); burn-rate + progress done; queued dropped as out-of-scope | 3 | High / optional |

## Data-readiness map (verified against source)

| Design element | Source field | Status |
|---|---|---|
| context% ring, cost | `preciseContextPercent`, `preciseCostUsd` (statusline-cache.json) | ✅ exists |
| total tokens | `cumulativeUsage` sum | ✅ |
| main model chip | `state.model` | ✅ |
| agent nodes + per-agent tokens | `subagents` Map → `SubAgentState.tokens` | ✅ |
| agent status | `status` (running/completed only) | ⚠️ no "queued" |
| economics: I/O split + cache savings | `TokenUsage.{input,output,cacheCreation,cacheRead}` | ✅ full data |
| feed + spawn events | `recentToolCalls`, `Task` blocks | ✅ (ts = parse-time) |
| files touched | filter `recentToolCalls.detail` (file_path) | ✅ derive |
| per-agent model | `message.model` in subagent transcript | ⚠️ read but not stored → Phase 2 |
| spawn reason | `Task.input.description` | ⚠️ seen but not stored → Phase 2 |
| drill-down per-agent calls | parse subagent transcript content blocks | ⚠️ Phase 3 |
| heartbeat real time-axis | `events-*.ndjson` `ts`+`agentId`; subagent line `timestamp` | ⚠️ Phase 3 |
| agent nesting (planner→researcher) | `parentAgentId` from each agent's `.meta.json` sidecar | ✅ Phase 4 (redesigned + real-data verified) |
| queued agents | not in hook data (only post-spawn) | ❌ Phase 4 (plan/todo integration) |
| burn rate, per-agent progress | derive/sample | ⚠️ Phase 4 |

## Key research findings

- **Sidebar is a `TreeView` today** — must register a new `WebviewViewProvider` (contributes a
  `views` entry of type `webview`). The mockup is the render target.
- **Subagent transcript schema** (verified on real files): top keys `agentId, sessionId,
  isSidechain, parentUuid, uuid, message, timestamp, type, cwd, gitBranch, version`. The transcript
  line itself has no `parentAgentId`, and the spawning tool_use's `id` is **not** the child's agentId
  (corrected during Phase 4's real-run verification — see that phase's Outcome/Risk Assessment). The
  actual source of truth is a sibling `agent-<agentId>.meta.json` sidecar carrying `agentType`,
  `description`, `parentAgentId`, and `toolUseId` — not discovered until Phase 4 spawned a real nested
  run and inspected the on-disk files.
- **The spawn tool is named `Agent`, not `Task`**, in real transcripts (also found during Phase 4's
  real-run verification) — every `Task`-string match anywhere in Phases 2-4 was silently matching
  nothing until fixed.
- **`message.model` and `Task.input.description` are already in the data** the reducer reads — they
  are simply dropped today. Capturing them is a small, low-risk `SubAgentState` extension (Phase 2).
- **Cache economics needs zero new data** — `cacheReadInputTokens` is already summed per agent and
  per session.

## Dependencies

- **Related (not blocking):** `20260710-0900-claudevisual-vscode-extension` (implemented) — this
  plan supersedes its Phase 2 and reuses its Phase 3/4/5 infra.
- **Build/deploy loop:** `npm run reinstall` (build + reinstall the extension).
