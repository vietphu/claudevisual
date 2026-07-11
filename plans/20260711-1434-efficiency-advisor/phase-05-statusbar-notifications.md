# Phase 05 — Status bar + notifications

**Priority:** P1 · **Status:** Not started · **Depends:** 01, 02

## Overview

Surface only the highest-severity signal ambiently: a status bar advisory indicator and,
for `critical` recommendations, an optional throttled VS Code notification.

## Files to touch

- Locate existing status-bar module (grep `StatusBarItem` under `src/ui/`); add an
  advisory item (e.g. `⚠ Context 91%` / `$(lightbulb) A`) reflecting the live/primary
  session's top recommendation or score grade.
- `src/extension.ts` — subscribe once to `currentStore.onDidChange`, run
  `analyzeSession` on the primary session, update the status bar item; fire a
  notification only when a NEW `critical` recommendation appears (dedupe by
  recommendation id + session, throttle so it fires once per condition, not per tick).
- Guard: notifications off by default OR a `claudevisual.advisor.notifyCritical` setting
  (default true) — respect the project's no-nagging ethos.

## Todo

- [ ] Advisory status bar item (top rec / grade), click → open dashboard advisor.
- [ ] Critical-only notification with per-(session, rec-id) dedupe + throttle.
- [ ] Setting `claudevisual.advisor.notifyCritical` in `package.json` contributes.
- [ ] Typecheck + build; manual check: context crossing 90% fires exactly one toast.

## Success criteria

- Status bar reflects live advisory without flicker; no notification spam (once per
  condition transition, never per debounce tick).
- Zero added cost to Claude Code (read-side only).

## Risks

- Notification fatigue → strict dedupe + critical-only + opt-out setting.
