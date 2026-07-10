# ClaudeVisual

Real-time visibility into [Claude Code](https://claude.com/product/claude-code) sessions,
right inside VS Code — plus in-editor editing of Claude Code's own config.

While working with Claude Code from the terminal, it's hard to see at a glance: how much
context is left, which workflow/skill/sub-agent is running, which model is active, what a
task is costing in tokens, and which permission mode you're in. ClaudeVisual surfaces all of
that live in the sidebar and status bar, without slowing Claude Code down or adding to its
token/cost overhead.

## Features

- **Status bar** — active model, context-window usage, permission mode, running indicator.
- **Sidebar TreeView** — per-session hierarchy: sub-agents, skills invoked, recent tool calls.
  Concurrent sessions in the same working directory render as separate siblings, never merged.
- **Dashboard webview** — hand-rolled token/cost/context-usage charts fed by incremental
  updates, plus a dual-scope (global + project) config-editing form with diff/confirm and Undo
  on every write.
- **Opt-in hooks** — lower-latency "is it running now" signal than JSONL tailing alone.
  Installs safely: appends to existing hook arrays in `settings.json`, never replaces them.
- **Opt-in StatusLine wrap** — precise context%/cost numbers, without disturbing an existing
  `statusLine` command (wraps it, passes its output through unchanged; restore is byte-for-byte).

## Hard constraint

ClaudeVisual must never slow down or add token/cost overhead to Claude Code itself. Every
I/O surface it adds is an O(1) append or an O(1) small-file overwrite — no blocking reads, no
chatty hooks, no read-modify-write on hot paths.

## Installation

Not yet published to the VS Code Marketplace (staying on `0.x` until the settings.json
safe-write path has real multi-machine use — see
[the packaging phase notes](plans/20260710-0900-claudevisual-vscode-extension/phase-07-packaging.md)).
Until then, build and install locally:

```bash
npm install
npm run reinstall   # builds, packages, and force-installs into your default VS Code profile
```

Then reload the VS Code window (`Cmd+Shift+P` > "Developer: Reload Window") to activate it.

See [docs/deployment-guide.md](docs/deployment-guide.md) for the full build/deploy workflow,
including the faster F5 Extension Development Host loop for active development.

## Usage

1. Open a project you use Claude Code in.
2. The ClaudeVisual sidebar (activity bar icon) and status bar populate automatically from
   that session's JSONL transcript — no configuration needed for the baseline.
3. Optionally, from the Command Palette:
   - `ClaudeVisual: Install Hooks` — faster running-indicator.
   - `ClaudeVisual: Wrap StatusLine` — precise context%/cost (wraps, never overwrites, an
     existing `statusLine` command).
   - `ClaudeVisual: Open Dashboard` — charts + config-editing form.

## Development

```bash
npm install
npm run watch        # esbuild watch mode
npm run typecheck
npm test              # unit tests (Mocha, pure functions — no VS Code runtime needed)
```

Press `F5` in VS Code to launch an Extension Development Host running the extension from
source. See [docs/deployment-guide.md](docs/deployment-guide.md) for the full dev/deploy
workflow and [docs/manual-live-checklist.md](docs/manual-live-checklist.md) for the manual
E2E checklist covering hooks, statusline wrap, and config-write/Undo behavior against a real
Claude Code session.

## Project structure

```
src/
├── core/          # JSONL tailing, transcript parsing, session state reduction/store
├── hooks/         # Opt-in hooks + statusline wrap; safe settings.json read-modify-write
├── config/        # Settings schema, path resolution, config-writer (dual-scope)
├── ui/
│   ├── tree-view/     # Sidebar TreeView
│   ├── webview/       # Dashboard host-side (panel, charts, config form)
│   └── webview-ui/    # Dashboard browser-side bundle
└── extension.ts   # Composition root
```

Full implementation plan and phase-by-phase design notes:
[plans/20260710-0900-claudevisual-vscode-extension/](plans/20260710-0900-claudevisual-vscode-extension/).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
