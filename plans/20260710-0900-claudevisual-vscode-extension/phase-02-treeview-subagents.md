# Phase 2 — Sidebar TreeView + Sub-agents

## Context Links
- Overview: [plan.md](plan.md) · Depends on: [Phase 1](phase-01-jsonl-baseline.md)
- Source: `<sessionUUID>/subagents/agent-<id>.jsonl`, Task tool_use blocks with `subagent_type`

## Overview
- **Priority:** High (primary read surface beyond the status bar).
- **Status:** Not Started
- **Description:** Add a sidebar TreeView showing per-session hierarchy including sub-agents,
  skills invoked, and recent tool calls. Extend tailing to sub-agent transcripts and the reducer to
  track sub-agent state. Renders concurrent same-cwd sessions as sibling nodes.

## Key Insights (verified live)
- Sub-agent transcripts live at `<sessionUUID>/subagents/agent-<id>.jsonl`.
- Sub-agent invocations are detected via `Task` tool_use blocks carrying `subagent_type`.
- **Two concurrent sessions can share the same `cwd`** (real observed case: `aify-web`) — they must
  render as sibling nodes, **never merged**. Keying is by `sessionId`, not by `cwd`.

## Requirements
**Functional**
- TreeView hierarchy: `Session > {Sub-agents, Skills invoked, Recent tool calls}`.
- Dynamically add watchers for `<sessionUUID>/subagents/*.jsonl` as new session dirs appear
  (narrow glob per known session).
- `state-reducer`/`types` gain `subagents: Map<agentId, SubAgentState>`.
- Multiple sessions with identical `cwd` shown as separate sibling roots.

**Non-functional**
- Reuse Phase 1 tailer/parser/store — no duplicate parsing path (DRY).
- Watchers narrowed per known session; no broad recursive watch.

## Architecture
Data flow (extends Phase 1):
```
session-registry (new sessionId appears)
   ──▶ jsonl-tailer registers watcher for <sessionUUID>/subagents/*.jsonl (narrow glob)
   ──▶ transcript-parser (reused) ──▶ state-reducer (adds SubAgentState on Task tool_use)
   ──▶ session-state-store
store.onDidChange ──▶ session-tree-provider.refresh() ──▶ tree-nodes render
```
File ownership: this phase owns `src/ui/tree-view/*` and additive edits to `jsonl-tailer.ts`,
`state-reducer.ts`, `types.ts`. Disjoint from Phase 3's `hooks/*` files.

## Related Code Files
**Create**
- `src/ui/tree-view/session-tree-provider.ts` — implements `vscode.TreeDataProvider`.
- `src/ui/tree-view/tree-nodes.ts` — node model: session / sub-agent / skills / tool-call nodes.

**Modify**
- `src/core/jsonl-tailer.ts` — dynamically add per-session sub-agent watchers.
- `src/core/state-reducer.ts` — handle Task tool_use → `SubAgentState`; track skills + recent tools.
- `src/core/types.ts` — add `SubAgentState`, `subagents` map, skill/tool-call fields.
- `package.json` — add `contributes.viewsContainers` + `views` (sidebar container + TreeView).

**Delete** — none.

## Implementation Steps
1. Extend `types.ts`: `SubAgentState { agentId, subagentType, status, tokens }`; add `subagents`, `skillsInvoked`, `recentToolCalls` to `SessionState`.
2. Extend `state-reducer.ts`: on `assistant` tool_use `Task` block, upsert `SubAgentState` keyed by `agentId`/`subagent_type`; record skills + recent tool calls.
3. Extend `jsonl-tailer.ts`: when registry reports a new session dir, register a narrow watcher for its `subagents/*.jsonl`; route lines through existing parser/reducer.
4. Add `contributes.viewsContainers` + `views` to `package.json`.
5. Implement `tree-nodes.ts` node types + `session-tree-provider.ts` (`getChildren`/`getTreeItem`, `refresh()` on store change).
6. Verify: run a real session with a Task call → sub-agent node updates; launch two same-cwd sessions → two sibling roots.

## Todo List
- [ ] `types.ts`: `SubAgentState` + maps
- [ ] `state-reducer.ts`: Task tool_use → sub-agent, skills, tool calls
- [ ] `jsonl-tailer.ts`: dynamic per-session sub-agent watchers
- [ ] `package.json`: viewsContainers + views
- [ ] `tree-nodes.ts`
- [ ] `session-tree-provider.ts`
- [ ] Verify sub-agent node + same-cwd siblings

## Success Criteria
A real session running a Task tool call shows a correctly updating sub-agent node, and two
concurrent same-cwd sessions render as separate siblings (not conflated).

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Same-cwd sessions merged into one node | Med | High | Key strictly by `sessionId`; test the two-session case explicitly. |
| Broad recursive watch on subagents dirs (perf) | Med | Med | Register narrow glob per known session only, added lazily. |
| Showing every machine session (privacy/noise) | Med | Med | Registry pre-filtered by open workspace cwd (Phase 1 guarantee). |
| Watcher leak on session end | Low | Med | Dispose sub-agent watchers when a session leaves the registry. |

## Security Considerations
- Read-only phase (no writes to Claude Code files).
- Scope watchers to sessions belonging to the open workspace folder(s) only — never surface other
  projects' sub-agents.
- Dispose watchers on deactivate and on session exit to avoid handle leaks.

## Next Steps
- Independent of Phase 3; both can run in parallel off Phase 1. Feeds richer state into Phase 5 webview.
