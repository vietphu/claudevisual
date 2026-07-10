# Phase 1 — JSONL-only Baseline

## Context Links
- Overview: [plan.md](plan.md)
- Source: `~/.claude/projects/<hashed-cwd>/*.jsonl`, `~/.claude/sessions/<pid>.json`
- Prior art (JSONL-tailing only): `ccusage-vscode-extension`, `vscode-claude-status`

## Overview
- **Priority:** Highest (foundation — all other phases read this phase's `SessionState`).
- **Status:** Not Started
- **Description:** Build the zero-footprint monitoring baseline: read Claude Code's live JSONL
  transcripts + session registry, reduce to per-session state, render a status bar item. No hooks,
  no statusline, no settings writes — the extension writes to **zero** Claude Code files in this phase.

## Key Insights (verified live on this machine)
- `~/.claude/projects/<hashed-cwd>/*.jsonl` are live, append-only session transcripts. Observed
  `type` values: `user`, `assistant`, `mode`, `queue-operation`, `attachment`,
  `file-history-snapshot`, `last-prompt`, `ai-title`. **Parser must tolerate unknown types —
  log-and-skip, never throw.**
- `assistant` lines carry `message.model` and `message.usage` (`input_tokens`, `output_tokens`,
  `cache_creation_input_tokens`, `cache_read_input_tokens`) plus a nested `message.usage.iterations[]`
  array. **Correction (verified empirically across multiple real transcripts, superseding the earlier
  grep-only assumption): top-level `message.usage` already equals the sum of iterations whose
  `type === "message"`. Iterations with `type === "advisor_message"` (a separate internal call, seen
  using a different model, e.g. `claude-opus-4-6`) are NOT included in the top-level totals — they
  represent genuinely separate token spend. Use top-level `message.usage` directly as the primary
  session total (do NOT sum all iterations — that double-counts). Advisor-iteration usage may be
  surfaced separately in a later phase as a distinct "advisor spend" figure, out of scope for Phase 1.**
- `mode` lines (`{"type":"mode","mode":"normal"}`) are the live permission-mode signal.
- `~/.claude/sessions/<pid>.json` is a live registry of running processes:
  `{pid, sessionId, cwd, startedAt, version, kind, entrypoint}`. Filter by `cwd` matching the open
  workspace folder. Two concurrent sessions can share the same `cwd` — keep both.
- VS Code API: scope `createFileSystemWatcher` narrowly to the specific project-hash subdir (never
  all of `~/.claude/projects/`). Track per-file byte offsets, read only the appended tail, buffer
  partial trailing lines until a newline arrives before `JSON.parse`.

## Requirements
**Functional**
- Resolve open workspace folder → `~/.claude/projects/<hash>` path.
- Tail all `*.jsonl` in that dir; parse each complete line; reduce to `SessionState`.
- Read session registry; determine live vs idle per session by `cwd` match.
- Status bar shows: `model | context≈% | tokens | ●live/○idle`.
- Context% is **approximated** from cumulative usage vs a static model-context-window-size table,
  labeled with a `~` prefix (precise value comes in Phase 4).

**Non-functional**
- Zero writes to any Claude Code file. No whole-file re-reads. Offset-tracked tail only.
- Each source file < ~200 lines, modularized by concern.

## Architecture
Data flow:
```
fs watcher (project-hash dir) ──▶ jsonl-tailer (offset+partial-line buffer)
   ──▶ transcript-parser (JSON.parse + type dispatch, tolerant)
   ──▶ state-reducer (pure: (SessionState, ParsedLine) -> SessionState)
   ──▶ session-state-store (Map<sessionId,SessionState> + debounced EventEmitter)
session-registry (poll ~/.claude/sessions/*.json, filter by cwd) ──▶ store (live/idle flag)
store.onDidChange ──▶ status-bar.render()
```
`extension.ts` = wiring only (<100 lines): construct modules, register status bar, dispose on deactivate.

## Related Code Files
**Create**
- `package.json` — manifest: activation event, `contributes.commands` (minimal), status bar contribution wiring in code.
- `tsconfig.json` — `strict:true`.
- `esbuild.js` — two entry points scaffolded (extension host now; webview stub for later phases).
- `src/extension.ts` — `activate()`/`deactivate()` wiring.
- `src/core/project-hash.ts` — workspaceFolder → `~/.claude/projects/<hash>` mapping.
- `src/core/jsonl-tailer.ts` — offset-tracked tailing, partial-line buffering.
- `src/core/transcript-parser.ts` — `JSON.parse` + line-type dispatch, tolerant of unknown types.
- `src/core/state-reducer.ts` — pure reducer; sums `iterations[]` usage.
- `src/core/session-registry.ts` — reads `~/.claude/sessions/<pid>.json`, filtered by cwd.
- `src/core/session-state-store.ts` — `Map<sessionId,SessionState>` + debounced `vscode.EventEmitter`.
- `src/core/types.ts` — `SessionState`, `ParsedLine`, usage/model types, model-context-size table.
- `src/ui/status-bar.ts` — renders the status bar item from store state.
- `src/diagnostics/logger.ts` — output channel gated by a debug setting.

**Modify** — none (new project).
**Delete** — none.

## Implementation Steps
1. Scaffold `package.json`, `tsconfig.json`, `esbuild.js` (host + webview entry stubs), `src/extension.ts`.
2. Implement `project-hash.ts`; verify it resolves to a real existing dir for this project.
3. Implement `jsonl-tailer.ts`: open file, track byte offset, on watcher change read `[offset..end]`, split on `\n`, hold trailing partial in a buffer, emit complete lines.
4. Implement `transcript-parser.ts`: `JSON.parse` guarded by try/catch (log-and-skip on error), dispatch by `type`, ignore/skip unknown types.
5. Implement `state-reducer.ts`: pure fn; for `assistant` sum `iterations[].usage` (fallback top-level), update model; for `mode` update permission mode.
6. Implement `session-registry.ts`: read `~/.claude/sessions/*.json`, filter by cwd, expose live sessionIds.
7. Implement `session-state-store.ts`: keyed by sessionId, debounced change event.
8. Implement `status-bar.ts`: subscribe to store, render `model | ~context% | tokens | ●/○`.
9. Wire everything in `extension.ts`; add `logger.ts`.
10. Run in Extension Development Host against a real project; confirm live updates + zero writes.

## Todo List
- [x] Scaffold manifest + esbuild + tsconfig + extension.ts
- [x] `project-hash.ts` (+ `normalizeCwd` for realpath-safe cwd comparison)
- [x] `jsonl-tailer.ts` (offset + partial-line buffer, bounded prime, per-file read lock, idle-flush)
- [x] `transcript-parser.ts` (tolerant dispatch)
- [x] `state-reducer.ts` (uses top-level `message.usage` directly — verified NOT to sum with
      `iterations[]`, see corrected Key Insight above; tracks `lastTurnContextTokens` separately
      from cumulative usage)
- [x] `session-registry.ts` (cwd-filtered, realpath-normalized)
- [x] `session-state-store.ts` (debounced emitter; now fed by all workspace-folder tailers into one
      shared store, never one store per folder)
- [x] `types.ts` + model-context-size table
- [x] `status-bar.ts`
- [x] `logger.ts`
- [x] `tsc --noEmit` and `esbuild` both pass
- [x] Independent code review (code-reviewer agent) — 2 critical + 3 high findings, all fixed:
      unbounded historical backfill (now bounded to newest file's last ~2MB), read-race causing
      duplicate-counted tokens (now per-file serialized), silently-dropped unterminated final line
      (now idle-flushed after 1s), multi-root last-write-wins status bar (now one merged store),
      unnormalized cwd liveness comparison (now realpath-normalized)
- [ ] Dev Host live-update verification (zero writes) — **not performed**: this environment has no
      VS Code GUI/`code` CLI available to launch an Extension Development Host. Needs to be run
      manually by the user (F5 in VS Code on this folder) before Phase 1 is considered fully done.

## Success Criteria
Extension Development Host shows the status bar updating live off a real JSONL file for this
project (or another real project), with **zero writes** to any Claude Code file. Context% shown with
`~` prefix; live/idle dot reflects session registry.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Whole-file re-reads on large transcripts (perf) | Med | High | Strict offset-tracked tail; never re-read; buffer partial lines. |
| Unknown/new line `type` throws parser | Med | High | try/catch + log-and-skip; dispatch tolerant of unknown types. |
| Watcher scoped too broadly (all projects) | Med | Med | Scope watcher to the single project-hash subdir only. |
| Context% approximation misleads user | High | Low | Prefix with `~`; document it is replaced by precise value in Phase 4. |

## Security Considerations
- Read-only phase — no writes to Claude Code files, no settings mutation, no spawned processes.
- Registry filtered by cwd → never surface other projects' sessions (privacy/noise).
- Logger gated behind a debug setting; do not log transcript contents at default level.

## Next Steps
- Unblocks Phase 2 (TreeView reads store) and Phase 3 (hooks overlay onto same store), which can proceed in parallel.
