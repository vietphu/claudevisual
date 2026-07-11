# Session visibility + Advisor color cues

## Context

Sidebar webview (`src/ui/webview-view-ui/`, view-model in `src/ui/webview-view/sidebar-messages.ts`).
Currently a session's detail body defaults open when `s.live` is true (`main.ts` renderSession:
`sessionOverrides.get(s.sessionId) ?? !s.live`). User wants sessions always collapsed by default
regardless of live state, a clearer affordance to expand, a way to tell an expanded session's
detail apart from its siblings, and grade-based color cues in the collapsed row so low Advisor
scores stand out without opening detail.

## Requirements

1. Every session's body defaults to collapsed; only an explicit user click keeps one open (no more
   `!s.live` auto-expand).
2. The toggle affordance reads as an obvious "View detail" button, not just an implicit chevron.
3. An expanded session is visually distinct from its (collapsed) siblings while scrolling its body
   — accent-colored frame + the identifying vitals header pinned (sticky) at the top of its card.
4. The collapsed vitals row itself carries the Advisor grade as a small colored badge, and the
   card's left border tints to the grade's severity color (good/warn/crit) — so a low score is
   visible in the list without expanding.

## Files

- `src/ui/webview-view-ui/render-advisor.ts` — export `gradeSeverity` for reuse.
- `src/ui/webview-view-ui/render-vitals.ts` — grade badge + severity-tinted vitals border +
  explicit "View detail"/"Hide detail" toggle label.
- `src/ui/webview-view-ui/main.ts` — collapse-by-default (`?? true` instead of `?? !s.live`).
- `src/ui/webview-view-ui/sidebar.css` — badge styles, toggle-button styles, expanded-session
  accent frame, sticky vitals header.

## Todo

- [x] Export `gradeSeverity` from render-advisor.ts
- [x] main.ts: always-collapsed default
- [x] render-vitals.ts: grade badge + explicit toggle button label + severity border hook
- [x] sidebar.css: badge/toggle/expanded-frame/sticky-header styles
- [x] typecheck + build
- [x] code-reviewer pass
