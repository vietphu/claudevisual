---
title: "ClaudeVisual — VS Code extension for Claude Code observability + config editing"
description: "Real-time context/token/cost/workflow visibility for Claude Code, plus in-editor settings.json editing."
status: implemented
priority: P1
effort: 7 phases
branch: none (no git repo yet)
tags: [vscode-extension, typescript, claude-code, observability, esbuild]
created: 2026-07-10
---

# ClaudeVisual — Implementation Plan

VS Code extension giving real-time visibility into Claude Code's context-window usage, active
workflow/skill/sub-agent, active model, per-task token/cost, and permission mode — plus in-editor
Claude Code config editing (global + project settings.json). Hybrid data source: JSONL tailing
baseline + opt-in hooks + opt-in statusLine wrap.

**HARD CONSTRAINT (all phases):** must never slow down or add token/cost overhead to Claude Code
itself. Every new I/O surface must be O(1) append or O(1) small-file overwrite. No blocking reads,
no chatty hooks, no read-modify-write on hot paths.

## Tech Stack (final)
TypeScript `strict:true` · manual `package.json` + `esbuild` (2 entry points: extension host +
webview) · native `fs` + `vscode.workspace.createFileSystemWatcher` (no chokidar) · hand-rolled
canvas/SVG sparklines (no chart lib) · `@vscode/test-electron` + Mocha for pure-fn unit tests ·
`@vscode/vsce` packaging (0.x until multi-machine proven). File naming: kebab-case for all TS/JS files.

## Phases

| # | Phase | Status | Depends on |
|---|-------|--------|-----------|
| 1 | [JSONL-only baseline](phase-01-jsonl-baseline.md) | Done | — |
| 2 | [Sidebar TreeView + sub-agents](phase-02-treeview-subagents.md) | Done | Phase 1 |
| 3 | [Hooks + event log (opt-in)](phase-03-hooks-event-log.md) | Done | Phase 1 |
| 4 | [StatusLine opt-in wrap](phase-04-statusline-wrap.md) | Done | Phase 3 |
| 5 | [WebviewPanel: charts + config form](phase-05-webview-charts-config.md) | Done | Phase 1, 3, 4 |
| 6 | [Testing](phase-06-testing.md) | Done — unit tier green (73/73); manual live checklist documented, not yet walked on real hardware | Phase 1–5 |
| 7 | [Packaging](phase-07-packaging.md) | Done — .vsix builds + content-verified; fresh-profile install still pending (human/GUI step) | Phase 1–6 |

## Key Dependencies
- Phase 1 is the foundation: core parsing/state/store + status bar. Everything reads its `SessionState`.
- Phases 2, 3 both depend only on Phase 1 → can proceed in parallel (disjoint file ownership: Phase 2 owns `ui/tree-view/*`; Phase 3 owns `hooks/*` + `core/event-log-reader.ts`).
- Phase 4 depends on Phase 3 (reuses `installer.ts` / `json-merge.ts`).
- Phase 5 depends on Phase 1 (charts) and Phases 3/4 (config toggles delegate to those installers). `config-writer.ts` reuses Phase 3's `json-merge.ts` — single safe-write path.
- Phase 6 validates 1–5 (unit tier can start once pure fns exist). Phase 7 packages once 1–6 stable.

## Open Questions (tracked in phase files)
- ~~Phase 5: does Claude Code fully override or deep-merge project-level settings.json over global, per-key?~~ Resolved: per-key scalar override (project value wins per key when present, else falls through to global); array fields like `permissions.allow` are concatenated+deduped instead. See citation comment at top of `src/config/settings-paths.ts`.
