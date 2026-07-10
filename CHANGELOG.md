# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.0.1] — 2026-07-10

Initial implementation, all 7 planned phases.

### Added
- JSONL-tailing baseline: session state (model, tokens, context%, permission mode) parsed
  live from Claude Code's own transcript files. Status bar display.
- Sidebar TreeView: per-session hierarchy of sub-agents, skills invoked, and recent tool
  calls. Sessions keyed by `sessionId`, so concurrent same-cwd sessions render as siblings.
- Opt-in hooks (`ClaudeVisual: Install/Uninstall Hooks`): low-latency running-indicator via
  a dedicated NDJSON event log, safely appended to `settings.json`'s hook arrays.
- Opt-in StatusLine wrap (`ClaudeVisual: Wrap/Preview/Restore StatusLine`): precise
  context%/cost numbers, wrapping (never overwriting) an existing `statusLine` command.
- Dashboard webview (`ClaudeVisual: Open Dashboard`): hand-rolled charts fed by incremental
  diffs, dual-scope (global/project) config-editing form with diff/confirm + Undo.
- Unit test suite (84 tests) covering transcript parsing, state reduction, project-hash
  mapping, and the settings.json safe-write path; manual live/E2E checklist for the
  hook/statusline/config paths.
- `.vsix` packaging via `@vscode/vsce`; local build/deploy workflow (`npm run reinstall`).

### Fixed
- Concurrent writes to `settings.json` could race and silently drop a change — writes are
  now serialized per file path.
- Undo could delete a user's entire `settings.json` instead of reverting one field when no
  prior backup existed — now scoped to the specific key, with a hash guard that refuses
  rather than clobbers if other writes landed since.
- Hook/statusline commands baked in a version-specific extension path that broke after every
  VS Code auto-update — matching is now version-independent.
- The JSONL tailer could do an unbounded full-file read on a resumed older session's first
  live touch — now tail-primes consistently with activation-time behavior.
- Sub-agent file watchers leaked indefinitely — now disposed when a session drops out of the
  known-session set.
