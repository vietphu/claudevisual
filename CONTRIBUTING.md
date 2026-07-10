# Contributing to ClaudeVisual

## Setup

```bash
npm install
npm run watch
```

Press `F5` in VS Code to launch an Extension Development Host running the extension from
source. See [docs/deployment-guide.md](docs/deployment-guide.md) for the full dev/deploy
workflow.

## Before opening a PR

```bash
npm run typecheck
npm run compile
npm test
```

All three must pass clean. If your change touches the settings.json safe-write path
(`src/hooks/json-merge.ts`, `src/hooks/installer.ts`, `src/config/config-writer.ts`,
`src/hooks/hook-scripts/statusline-wrap.cjs`), also walk the relevant section of
[docs/manual-live-checklist.md](docs/manual-live-checklist.md) — that's the
highest-blast-radius surface in the codebase (a bug there can corrupt a user's real Claude
Code config).

## Ground rules

- **Never slow down or add overhead to Claude Code itself.** Every new I/O surface must be an
  O(1) append or O(1) small-file overwrite — no blocking reads, no chatty hooks, no
  read-modify-write on hot paths.
- **Settings.json writes go through one path.** All writes to a user's Claude Code
  `settings.json` must go through `src/hooks/json-merge.ts`'s backup + atomic
  write-then-rename + rollback logic — no parallel write path.
- Files over ~200 lines should generally be split by concern; kebab-case for all TS/JS/shell
  file names.
- No fake data, mocks, or workarounds to make tests pass — tests validate real behavior.

## Reporting issues

Open a GitHub issue with: what you expected, what happened, your VS Code version, and (if
relevant) your Claude Code `settings.json` shape with secrets redacted.
