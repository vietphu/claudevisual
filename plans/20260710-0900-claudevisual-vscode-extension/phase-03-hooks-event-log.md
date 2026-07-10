# Phase 3 — Hooks + Event Log (opt-in)

## Context Links
- Overview: [plan.md](plan.md) · Depends on: [Phase 1](phase-01-jsonl-baseline.md)
- Reusable pattern: `~/.claude/hooks/node-hook-runner.sh` (real cross-platform node-locator shim)

## Overview
- **Priority:** High (low-latency "is it running now" signal ahead of JSONL landing).
- **Status:** Completed
- **Description:** Opt-in hooks that append normalized NDJSON events to a dedicated log the
  extension already file-watches. Safe, reversible settings.json merge that appends our matcher
  groups without disturbing existing hooks. Event-log reader overlays low-latency running state.

## Key Insights (verified live)
- Hooks in `settings.json` are **arrays**: `hooks.<EventName> = [{matcher, hooks:[{type:"command",
  command, timeout}]}]`. Safe to **append** a new group without disturbing existing ones.
- Hook stdin payload: `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`,
  plus `tool_name`/`tool_input`/`tool_response` for tool events, `agent_id`/`agent_type` for
  subagent contexts. **No token/context%/cost in hook payloads** — but fires at the exact lifecycle
  transition (lowest latency).
- This machine already has hooks like `scout-block.cjs` / `privacy-block.cjs` — uninstall must leave
  those untouched, removing only entries whose command matches our bundled script path.
- `node-hook-runner.sh` already on this machine is a working cross-platform node-locator shim
  (`node` → `node.exe` → `cygpath` for Git-Bash/Windows) — mirror it, do not reinvent.

## Requirements
**Functional**
- `emit-event.cjs`: no deps; append **one** normalized NDJSON line per hook event —
  `{ts, sessionId, hookEvent, toolName?, agentId?, agentType?, permissionMode}` — to
  `~/.claude/claudevisual/events-<pid-or-sessionId>.ndjson`. O(1) append only; exit fast; never block.
- `runner.sh`: cross-platform node-locator shim mirroring `node-hook-runner.sh`.
- Command `ClaudeVisual: Install Hooks`: append one matcher-group per relevant event
  (PreToolUse, PostToolUse, SubagentStart, SubagentStop, SessionStart, UserPromptSubmit, Stop) to
  each `hooks.<Event>` array. Timestamped backup first, then atomic write-then-rename. Defensively
  verify each target is an array before appending.
- Command `ClaudeVisual: Uninstall Hooks`: remove **only** entries whose command matches our bundled
  script path; leave all pre-existing entries intact.
- `event-log-reader.ts`: offset-tracked tail (same technique as `jsonl-tailer.ts`) overlaying
  low-latency running state onto `SessionState`.

**Non-functional**
- Hook scripts do only O(1) appends. No local HTTP/socket server (avoids ports/lifecycle ordering).
- `json-merge.ts` is the single safe read-modify-write JSON path (reused by Phase 4 + 5).

## Architecture
Data flow:
```
Claude Code lifecycle event ──▶ runner.sh ──▶ emit-event.cjs
   ──▶ append 1 NDJSON line ──▶ ~/.claude/claudevisual/events-*.ndjson
extension: fs watcher ──▶ event-log-reader (offset tail) ──▶ session-state-store (running overlay)
Install/Uninstall Hooks command ──▶ installer.ts ──▶ json-merge.ts
   ──▶ backup settings.json ──▶ atomic write-then-rename (array append, not replace)
```
File ownership: this phase owns `src/hooks/*` + `src/core/event-log-reader.ts`. Disjoint from Phase 2.

## Related Code Files
**Create**
- `src/hooks/installer.ts` — orchestrates settings.json merge for hooks (statusline wrap added in Phase 4).
- `src/hooks/json-merge.ts` — generic safe read-modify-write JSON merge with backup/rollback.
- `src/hooks/hook-scripts/emit-event.cjs` — bundled Node script hooks invoke; 1 NDJSON line/event.
- `src/hooks/hook-scripts/runner.sh` — cross-platform node-locator shim (mirrors node-hook-runner.sh).
- `src/core/event-log-reader.ts` — offset-tracked tail of the NDJSON event log.

**Modify**
- `src/core/session-state-store.ts` — accept running-state overlay from event-log-reader.
- `src/core/types.ts` — add running/last-event fields to `SessionState`.
- `package.json` — register `ClaudeVisual: Install Hooks` / `Uninstall Hooks` commands.
- `esbuild.js` — ensure `hook-scripts/*` are copied/bundled into the packaged output.

**Delete** — none.

## Implementation Steps
1. Implement `json-merge.ts`: read → parse → backup (timestamped copy) → mutate in memory → atomic write-then-rename → rollback on failure. Array-type assertion before append.
2. Implement `emit-event.cjs` (zero deps): read stdin JSON, map to normalized record, append one line + `\n` to `events-<sessionId>.ndjson`, exit 0 fast; swallow/ignore errors (fail-open, never block Claude).
3. Implement `runner.sh` mirroring `node-hook-runner.sh` (node → node.exe → cygpath).
4. Implement `installer.ts` install path: for each of the 7 events, append a matcher-group invoking `runner.sh emit-event.cjs`; verify each `hooks.<Event>` is an array first; write via `json-merge.ts`.
5. Implement `installer.ts` uninstall path: filter each event array, removing only entries whose command references our bundled script path.
6. Implement `event-log-reader.ts`: offset-tail the NDJSON, parse each line, push running overlay into the store ahead of the JSONL line.
7. Register commands in `package.json`; ensure esbuild ships `hook-scripts/`.
8. Verify: after Install, a tool call flips running-indicator faster than JSONL baseline; Uninstall diff shows only our entries removed.

## Todo List
- [x] `json-merge.ts` (backup + atomic write + rollback + array assertion)
- [x] `emit-event.cjs` (O(1) append, fail-open, zero deps)
- [x] `runner.sh` (mirror node-hook-runner.sh)
- [x] `installer.ts` install (append 7 matcher-groups)
- [x] `installer.ts` uninstall (remove only our entries)
- [x] `event-log-reader.ts` (offset tail overlay)
- [x] `package.json` commands + esbuild ships hook-scripts
- [x] Verify faster running-indicator + clean uninstall diff (verified via fixture settings.json + live stdin smoke test; real "faster than JSONL" timing not measured in a running Claude Code session — see report)

## Success Criteria
After Install Hooks, a real tool call flips the running-indicator faster than the JSONL-only
baseline; Uninstall Hooks produces a settings.json diff showing **only** our entries removed
(pre-existing `scout-block.cjs`/`privacy-block.cjs` etc. untouched).

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Merge replaces/clobbers existing hook arrays | Med | High | Array append (not replace); assert array type; backup + atomic write-then-rename; rollback on failure. |
| Uninstall removes user's own hooks | Med | High | Match strictly by our bundled script path; leave everything else. |
| Hook script blocks/slows Claude Code | Low | High | Only O(1) append; fail-open; exit fast; never block on I/O. |
| Cross-platform portability (Windows/Git-Bash) | Med | Med | Mirror proven `node-hook-runner.sh` exactly; flag Windows test pass needed. |

## Security Considerations
- **"Must not slow Claude" gate:** `emit-event.cjs` does nothing but an O(1) append and exits — no
  network, no read-modify-write, no blocking. Verify explicitly.
- Every settings.json write is backed up (timestamped) before mutation and is reversible.
- No HTTP/socket server → no open ports, no lifecycle-ordering hazard.
- Event log stored under `~/.claude/claudevisual/`; contains lifecycle metadata only, not transcript bodies.

## Next Steps
- Unblocks Phase 4 (statusline wrap reuses `installer.ts`/`json-merge.ts` + extends `event-log-reader.ts`).
- `json-merge.ts` is the shared safe-write path reused by Phase 5 `config-writer.ts`.
