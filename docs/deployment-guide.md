# ClaudeVisual — Deployment Guide

Two separate loops, pick based on what you're doing.

## 1. Active source iteration → F5 Extension Development Host

Use this while editing ClaudeVisual's own code and testing the change immediately.

1. Open this repo in VS Code.
2. Run `npm run watch` in a terminal (esbuild watch mode, auto-rebuilds on save).
3. Press `F5` (or Run > Start Debugging). This opens a separate "Extension
   Development Host" window running the extension straight from `dist/` —
   no packaging step.
4. After a source change rebuilds, reload just that window: `Cmd+R` (or
   `Cmd+Shift+P` > "Developer: Reload Window") inside the Dev Host window.

No `.vsix` is produced in this loop. Fastest path for iterating on the
extension itself.

## 2. Deploy a real build into your daily-driver VS Code → `npm run reinstall`

Use this once a change is ready to actually use for observing real Claude
Code sessions across your other projects (dogfooding), not just testing in
the throwaway Dev Host window.

```bash
npm run reinstall
```

This runs `scripts/reinstall-extension.sh`, which:
1. Builds the production bundle and packages it (`npm run package` →
   `vsce package`, itself gated on `vscode:prepublish` → `compile:production`).
2. Force-installs the resulting `.vsix` into your **default** VS Code
   profile (`code --install-extension <vsix> --force` — overwrites the
   previous install even at the same 0.x version, no manual uninstall step).
3. Fires a macOS notification (via `osascript`, best-effort) reminding you
   to reload.

**One step VS Code doesn't expose a CLI flag for, so it stays manual:**
reload the window — `Cmd+Shift+P` > "Developer: Reload Window" — to
actually activate the newly installed build.

### One-time prerequisite: `code` CLI on PATH

`scripts/reinstall-extension.sh` fails fast with a fix hint if `code` isn't
found. To enable it:
- In VS Code: `Cmd+Shift+P` > "Shell Command: Install 'code' command in PATH", **or**
- Symlink manually, e.g.:
  ```bash
  ln -sf "/path/to/Visual Studio Code.app/Contents/Resources/app/bin/code" ~/.local/bin/code
  ```
  (use a PATH directory you can write to without `sudo` — `/usr/local/bin` is
  often root-owned; `~/.local/bin` or `/opt/homebrew/bin` usually aren't).

### Version policy

Stays on `0.x` until the settings.json safe-write path (`json-merge.ts`,
`config-writer.ts`, `statusline-wrap.cjs`) has real multi-machine use — see
`plans/20260710-0900-claudevisual-vscode-extension/phase-07-packaging.md` for
the original reasoning. `--force` on install means you don't need to bump the
version between local reinstalls.

As of 0.1.0, ClaudeVisual is public on GitHub and submitted to the Marketplace
despite that path only being proven on this machine's own (ClaudeKit-layered)
`settings.json` so far — the trade-off is deliberate: the safe-write path is
unit-tested and gated by a backup + atomic write-then-rename + rollback design
(see `docs/manual-live-checklist.md`), and going public is what actually
surfaces other machines' `settings.json` shapes. Bug reports on that path are
the main thing to watch closely post-launch.

## Turning on precise/low-latency data sources

Neither is required, but both are recommended once ClaudeVisual is
installed and you're pointing it at a real project:
- Command Palette > `ClaudeVisual: Install Hooks` — running-indicator flips
  in ~200–500ms instead of the JSONL baseline's ~2–5s.
- Command Palette > `ClaudeVisual: Wrap StatusLine` — exact context%/cost
  instead of the JSONL-derived approximation. Choose "Wrap", never
  "Overwrite", if you already have a statusline command configured.

Both write to `~/.claude/claudevisual/` — see the project memory
`claudevisual-log-paths` for the exact files and what's in them.
