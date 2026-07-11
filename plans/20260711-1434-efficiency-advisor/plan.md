# Efficiency Advisor — Implementation Plan

Turn ClaudeVisual's existing measurements (tokens, cost, context, cache, sub-agents)
into **actionable cost/efficiency recommendations + a composite Efficiency Score**,
surfaced real-time and as a per-session summary.

## Decisions locked (user)

- Form: **real-time nudges + retrospective report** (both).
- Focus: **both cost & workflow** → single composite Efficiency Score with breakdown.
- UI surfaces: **Sidebar section + Dashboard tab + Status bar / notification** (all three).

## Hard constraint (project-wide)

Read-side only. The advisor consumes `SessionStateStore` snapshots already in memory —
zero new I/O against Claude Code's hot paths. All analysis is pure + unit-tested.

## Architecture

```
SessionState (in store)
  └─ advisor-engine.analyzeSession(state) [PURE]
        ├─ derives AdvisorContext (context%, 4-bucket usage, economics, burn, sub-agents)
        ├─ runs advisor-rules[]  → Recommendation[] (severity-ranked)
        └─ efficiency-score()    → EfficiencyScore (0-100 + grade + sub-scores)
              ▼
        AdvisorResult ──► Sidebar section  (webview-view)
                     ──► Dashboard tab     (webview)
                     ──► Status bar item + notification (critical only)
```

## Phases

| # | Phase | Status | Depends |
|---|-------|--------|---------|
| 01 | [Advisor core: types, rules, engine](phase-01-advisor-core-engine.md) | ✅ Done (tested) | — |
| 02 | [Split-rate pricing + Efficiency Score](phase-02-pricing-and-score.md) | ✅ Done (tested) | 01 |
| 03 | [Sidebar Advisor section](phase-03-sidebar-advisor-section.md) | ✅ Done | 01, 02 |
| 04 | [Dashboard Advisor tab](phase-04-dashboard-advisor-tab.md) | ✅ Done | 01, 02 |
| 05 | [Status bar + notifications](phase-05-statusbar-notifications.md) | ✅ Done | 01, 02 |
| 06 | [Reducer enrichment (richer signals)](phase-06-reducer-enrichment.md) | ✅ Done (subset: compaction + stop_reason) | 01 |
| 07 | [Tests, docs, live checklist](phase-07-tests-docs.md) | ✅ Done | 01–06 |

## Key files touched

- New: `src/core/advisor/*` (engine, rules, types, score, thresholds).
- Extend: `src/core/model-pricing.ts` (split input/output/cache-write/cache-read rates).
- Subscribe: `src/core/session-state-store.ts` (`onDidChange`).
- Sidebar: `src/ui/webview-view/{session-view-model,sidebar-messages}.ts` +
  `src/ui/webview-view-ui/render-advisor.ts` (new) + `sidebar.css`.
- Dashboard: `src/ui/webview/{panel,messages}.ts` + client render.
- Status bar: `src/ui/status-bar/*` (or existing status-bar module) + `extension.ts`.

## Phasing rationale

Phases 01–02 deliver the pure, tested brain with **no UI risk**. 03–05 are the three
UI surfaces (independent, parallelizable). 06 is optional-enrichment: small reducer
captures (turn count, per-tool/skill counts, compaction events, main-session
`stop_reason`) that unlock higher-value rules — sequenced last so the core ships first.

## Open questions

- Efficiency Score weighting (context/cache/model-fit/orchestration) — start with a
  documented default in `advisor-thresholds.ts`; tune after real-session dogfooding.
- Model right-sizing is heuristic (opus + low output/tool volume). Phrase as "consider",
  never auto-assert — flagged for validation against real transcripts in Phase 01.
