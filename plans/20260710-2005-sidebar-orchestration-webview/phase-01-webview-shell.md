---
phase: 1
title: Webview Shell
status: completed
priority: P1
effort: 1-1.5d
dependencies: []
---

# Phase 1: Webview Shell

## Overview

Stand up a `WebviewViewProvider` for the sidebar that renders the redesigned layout (vitals header,
agent list, recent-activity feed, files-touched) from data **already** in `SessionState` — no
reducer changes. Delivers the visual redesign end-to-end with today's data and establishes the
state→webview message pipeline every later phase builds on.

## Requirements

- Functional: sidebar shows, per live session — vitals (context% ring, total tokens, cost, model
  chip, live/running pulse), a flat agent list (subagents with type + tokens + status), a
  recent-activity feed (last N tool calls with category color + icon + spawn events), and a
  files-touched list. Multiple concurrent sessions render as sibling cards.
- Non-functional: theme-aware (light+dark), fail-open when statusline/hooks data absent (fall back
  to `lastTurnContextTokens` for context %, hide cost), < 200 lines per file, no polling — pushes on
  `SessionStateStore.onDidChange`.

## Architecture

**Registration.** Add a `views` contribution of type `webview` (id e.g.
`claudevisual.sessionView`) in `package.json`, replacing/renaming the current TreeView contribution.
Keep the TreeView provider code in-tree but unregistered as a fallback until Phase 1 is verified on
real hardware, then delete in a follow-up.

**Host side** (`src/ui/webview-view/`):
- `sidebar-view-provider.ts` — implements `vscode.WebviewViewProvider`; on `resolveWebviewView`
  sets `webview.options` (enableScripts, localResourceRoots→dist), loads HTML, subscribes to
  `store.onDidChange`, and `postMessage`s a serialized view-model. Debounce already handled by the
  store.
- `session-view-model.ts` — pure function `toViewModel(sessions: SessionState[]): SidebarViewModel`.
  Serializes only what the client needs (numbers/strings/enums; no Maps/Dates). This is the
  contract; keep it small and typed. Unit-testable without vscode.
- `agent-color.ts` — deterministic `agentId → paletteIndex` (stable hash mod N) so identity colors
  are consistent across reloads and shared by all sections. Palette defined in CSS; host emits the
  index only.

**Client side** (`src/ui/webview-view-ui/`, esbuild second entry point — mirror existing
`webview-ui/`):
- `main.ts` — acquires vscode api ([vscode-api.ts](../../src/ui/webview-ui/vscode-api.ts) pattern),
  listens for `postMessage`, renders. No framework — direct DOM, matching repo convention.
- `render-vitals.ts`, `render-agents.ts`, `render-feed.ts`, `render-files.ts` — one renderer per
  section, each < 200 lines, pure `(vm) → HTMLString` or DOM patch.
- `sidebar.css` — port the mockup's token system (`:root` custom props + light/dark), adapted to
  VS Code theme variables where it reads native.

**Message protocol:** host → client `{ type: 'state', vm }`. client → host (stub for Phase 3
drill-down) `{ type: 'toggleAgent', agentId }`. Reuse the typed-message pattern from
[messages.ts](../../src/ui/webview/messages.ts).

## Related Code Files

- Create: `src/ui/webview-view/sidebar-view-provider.ts`,
  `src/ui/webview-view/session-view-model.ts`, `src/ui/webview-view/agent-color.ts`
- Create: `src/ui/webview-view-ui/main.ts`, `render-vitals.ts`, `render-agents.ts`,
  `render-feed.ts`, `render-files.ts`, `sidebar.css`
- Modify: `package.json` (views contribution + esbuild entry), `src/extension.ts`
  (register provider instead of / alongside TreeView), esbuild config
- Reference: `src/ui/webview/panel.ts`, `src/ui/webview-ui/vscode-api.ts`,
  `src/ui/tree-view/tree-nodes.ts` (label/status/detail formatting to reuse)
- Reference: `scratchpad/claudevisual-sidebar-mockup.html` (visual target)
- Delete (follow-up, after verify): `src/ui/tree-view/*`

## Implementation Steps

1. Add `views` (webview type) + second esbuild entry in `package.json`; wire build.
2. Write `session-view-model.ts` + `agent-color.ts` (pure, tested first).
3. Write `sidebar-view-provider.ts`; register in `extension.ts`, subscribe to store.
4. Port mockup CSS to `sidebar.css` with VS Code theme tokens; strip the mock IDE chrome
   (activity rail / editor backdrop) — only the sidebar column ships.
5. Write client `main.ts` + section renderers against the view-model. Wire theme via
   `body.vscode-light` / `vscode-dark` classes VS Code sets automatically.
6. CSP: set a strict `Content-Security-Policy` meta with a nonce for the bundled script; inline
   nothing else. Assets from `localResourceRoots` only.
7. `npm run reinstall`; verify against a live session (walk `docs/manual-live-checklist.md`).

## Success Criteria

- [ ] Sidebar renders vitals + agents + feed + files for a live session, styled per mockup.
- [ ] Context % shows precise value when statusline wrap installed, JSONL fallback otherwise; cost
      hidden when absent. No errors when `~/.claude/claudevisual/` is missing.
- [ ] Two concurrent sessions render as separate cards (parity with current keyed-by-sessionId).
- [ ] Correct in both VS Code light and dark themes.
- [ ] `toViewModel` + `agentColor` covered by unit tests (Mocha, pure-fn tier like existing).
- [ ] Every new file < 200 lines; `npm run typecheck` clean.

## Risk Assessment

- **Webview lifecycle** (view hidden/disposed then re-shown): re-post state on
  `onDidChangeVisibility`; keep last view-model in the provider. Mitigate with `retainContextWhenHidden`
  only if fl!cker observed (memory cost).
- **CSP / nonce mistakes** silently blank the view: verify script executes in devtools first.
- **Scope creep** — resist adding drill-down/heartbeat here; those are Phase 3. This phase = shell +
  today's data only.
