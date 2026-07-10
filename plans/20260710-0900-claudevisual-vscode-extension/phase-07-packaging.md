# Phase 7 — Packaging

## Context Links
- Overview: [plan.md](plan.md) · Depends on: [Phase 1](phase-01-jsonl-baseline.md)–[Phase 6](phase-06-testing.md) stable
- Tool: `@vscode/vsce`

## Overview
- **Priority:** Medium (ship gate; deferred to its own final phase by design).
- **Status:** Not Started
- **Description:** Package the extension into an installable `.vsix` once Phases 1–5 are stable and
  the Phase 6 checklist passes. Stay on 0.x until the safe-write path has real multi-machine use.
  Marketplace publish optional / non-blocking for personal use.

## Key Insights
- `@vscode/vsce package` only after Phases 1–5 stable and Phase 6 checklist passes.
- Stay on **0.x** versions (do not publish 1.0) until the safe-write path (`json-merge.ts`,
  `config-writer.ts`, `statusline-wrap.cjs`) has had real multi-machine use — **this machine's
  settings.json shape (ClaudeKit-layered) is not representative of a vanilla Claude Code install.**
- Marketplace publish is optional and non-blocking for personal use.

## Requirements
**Functional**
- `.vsix` builds via `@vscode/vsce package` from the esbuild production bundle.
- `.vscodeignore` excludes `test/`, source maps, and fixture data.
- Bundled hook scripts (`emit-event.cjs`, `runner.sh`, `statusline-wrap.cjs`) present in the packaged output.

**Non-functional**
- Version stays 0.x. Packaged build (not just dev host) exercises Phase 1–5 functionality.

## Architecture
```
esbuild (production, both entry points + hook-scripts copied)
   ──▶ @vscode/vsce package (respects .vscodeignore)
   ──▶ claudevisual-0.x.y.vsix
   ──▶ install into fresh VS Code profile ──▶ verify Phase 1–5 from packaged build
```

## Related Code Files
**Create**
- `.vscodeignore` — exclude `test/`, `**/*.map`, `test/fixtures/**`, source-only dirs.

**Modify**
- `package.json` — finalize `main`, `version` (0.x), `engines.vscode`, `publisher`, `categories`, `activationEvents`; `vscode:prepublish` runs production esbuild.
- `esbuild.js` — production/minified build; ensure hook-scripts copied into `dist`.

**Delete** — none.

## Implementation Steps
1. Add `.vscodeignore` excluding `test/`, source maps, fixtures.
2. Finalize `package.json` metadata (0.x version, engines, publisher, categories, activationEvents) + `vscode:prepublish` production esbuild.
3. Ensure `esbuild.js` production build copies `hook-scripts/*` into `dist`.
4. Run `@vscode/vsce package` → produce `.vsix`.
5. Install the `.vsix` into a **fresh VS Code profile**; verify Phase 1–5 functionality from the packaged build (not the dev host).
6. (Optional, non-blocking) publish to Marketplace once multi-machine safe-write use is established.

## Todo List
- [ ] `.vscodeignore` (test/, maps, fixtures)
- [ ] Finalize `package.json` metadata (0.x) + `vscode:prepublish`
- [ ] Production esbuild copies hook-scripts into dist
- [ ] `vsce package` → `.vsix`
- [ ] Install in fresh profile + verify Phase 1–5 from packaged build
- [ ] (Optional) Marketplace publish — deferred until multi-machine proven

## Success Criteria
A `.vsix` package installs cleanly in a fresh VS Code profile and Phase 1–5 functionality works from
the packaged build, not just the dev host.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Hook scripts missing from packaged bundle | Med | High | esbuild copies hook-scripts into dist; verify in fresh-profile install. |
| Test/fixture data shipped in vsix | Med | Med | `.vscodeignore` excludes `test/` + fixtures; inspect vsix contents. |
| Premature 1.0 on unproven safe-write path | Med | High | Stay 0.x until multi-machine use; this machine's ClaudeKit shape not representative. |
| Works in dev host but not packaged (path assumptions) | Med | Med | Verify from packaged build in a clean profile, not just F5. |

## Security Considerations
- Confirm no secrets, real transcripts, or sanitized-but-sensitive settings.json ship in the vsix
  (`.vscodeignore` + manual content inspection).
- Safe-write path (json-merge/config-writer/statusline-wrap) is the highest-blast-radius surface —
  gate 1.0 on real multi-machine validation, not just this ClaudeKit-layered machine.

## Next Steps
- Post-package: collect multi-machine feedback on safe-write path before considering 1.0 / Marketplace publish.
