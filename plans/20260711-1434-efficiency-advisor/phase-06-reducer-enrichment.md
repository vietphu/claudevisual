# Phase 06 — Reducer enrichment (richer signals)

**Priority:** P2 (unlocks higher-value rules) · **Status:** Not started · **Depends:** 01

## Overview

Small, O(1) additions to the pure reducer that capture signals the JSONL already carries
but the model currently discards. Each unlocks a stronger advisor rule. Kept last so the
core ships first; each capture is independently shippable.

## Signals to add (all derivable, no new I/O)

1. **Turn count** — increment in `reduceSessionState`'s assistant branch
   (`state-reducer.ts:57`). Enables `avgTokensPerTurn` (core efficiency ratio) +
   a `tokensPerTurnRule` (bloated turns).
2. **Per-skill / per-tool aggregate counts** — a `Map<name, count>` alongside the
   bounded ring (ring stays 20 for display; counts are cumulative). Enables a
   `redundantToolRule` (e.g. many repeated Reads of the same file).
3. **Compaction events** — `state-reducer.ts:116` already detects `/compact`; add a
   counter + last-compaction timestamp. Enables `frequentCompactionRule`
   (context thrash indicator).
4. **Main-session `stop_reason`** — currently parsed but discarded for main
   (only sub-agents use it). Capture last `stop_reason`; a `max_tokens` stop signals a
   truncated/inefficient turn → `maxTokensStopRule`.

## Files to touch

- `src/core/types.ts` — new optional fields on `SessionState` (default in
  `emptySessionState`): `turnCount`, `toolCallCounts` (record), `compactionCount`,
  `lastCompactionAt`, `lastStopReason`. Keep serializable.
- `src/core/state-reducer.ts` — increment/capture in the pure reducer.
- `src/core/transcript-types.ts` / `transcript-parser.ts` — surface `stop_reason` for
  main lines if not already parsed.
- `src/core/advisor/advisor-rules.ts` — add the four new rules gated on these fields.
- `src/core/advisor/advisor-context.ts` — expose derived `avgTokensPerTurn` etc.

## Todo

- [ ] Add fields + defaults; keep existing reducer invariants (sub-agent usage separate).
- [ ] Capture turn count, tool/skill counts, compaction count/ts, main stop_reason.
- [ ] Four new gated rules + context derivations.
- [ ] Extend `state-reducer.test.ts` for each new capture; rule tests.
- [ ] Typecheck + test green.

## Success criteria

- New fields populate on real transcripts; reducer stays pure + existing tests pass.
- Each new rule has fires/silent tests.

## Risks

- Reducer is a hot path (per-line) → keep additions O(1); no allocation per line beyond
  the small maps already implied. Respect the "never slow Claude Code" constraint
  (reducer runs in the extension, not Claude's process — but keep it cheap regardless).
