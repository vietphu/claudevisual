# Phase 02 — Optional: "cleared from <prev>" continuity hint

> **DEFERRABLE.** This phase is a stretch. If it fits cleanly as described below
> it adds real continuity value. If implementation reveals it needs nontrivial
> new architecture (a persistent cwd→session index, cross-render caching, etc.),
> **cut it** — it must never block Phase 1 or Phase 3. The core fix stands
> without it.

## Context Links

- Overview: [plan.md](plan.md)
- Depends on: [phase-01](phase-01-propagate-source-and-new-status.md) (needs
  `SessionViewModel.sessionStartSource`)
- Cross-session view: `src/ui/webview-view/session-view-model.ts:23-29`
  (`toSidebarViewModel` — the ONE place that holds the full `SessionState[]`)
- DTO: `src/ui/webview-view/sidebar-messages.ts:128-170`
- Render subtitle: `src/ui/webview-view-ui/render-vitals.ts:46-53`

## Overview

- **Priority:** P3 (optional / nice-to-have)
- **Status:** done
- **Description:** When a `source: "clear"` session with no activity appears,
  surface a small "cleared from <prev title/shortId>" hint in the subtitle so
  the user sees continuity instead of "my data vanished".

## Key Insights

- The lookup is inherently cross-session, so it must be computed in
  `toSidebarViewModel` (which already iterates the full array and sorts by
  `lastUpdatedAt` at line 27) — NOT in the per-session `toSessionViewModel`.
- No new index is required: the array is already sorted most-recent-first, so
  the predecessor is the first *other* session sharing the same `cwd`. This is
  O(n) per fresh session; n is tiny (a handful of sessions), so no caching needed
  — keeps YAGNI/KISS.
- "cleared from" only makes sense for `source === "clear"` (not `startup`, which
  has no predecessor). Gate on that literal specifically.

## Requirements

**Functional**
- A no-activity `clear` session whose `cwd` matches an older session shows
  `cleared from <that session's title || shortId>` in its subtitle.
- If no other same-cwd session exists, no hint is shown (silent).
- Non-`clear` sessions never show the hint.

**Non-functional**
- Pure, in the existing `toSidebarViewModel` transform; no new I/O, no new state.

## Architecture

```
toSidebarViewModel(sessions)
  ordered = sessions sorted by lastUpdatedAt desc   (already exists, line 27)
  for each fresh clear-session S with no activity:
     prev = first session in `ordered` where cwd===S.cwd and sessionId!==S.sessionId
     clearedFrom = prev ? (prev.title ?? prev.sessionId.slice(0,8)) : undefined
  → SessionViewModel.clearedFrom
render-vitals: append " · cleared from <clearedFrom>" to the subtitle when set
```

## Related Code Files

**Modify**
- `src/ui/webview-view/sidebar-messages.ts` — add `clearedFrom?: string` to
  `SessionViewModel`.
- `src/ui/webview-view/session-view-model.ts` — compute `clearedFrom` in
  `toSidebarViewModel` (it has the array); thread a value into
  `toSessionViewModel` (add a parameter) or post-process the mapped list.
- `src/ui/webview-view-ui/render-vitals.ts` — append the hint to the subtitle
  (escaped via existing `esc()`).

**Create / Delete:** none.

## Implementation Steps

1. **sidebar-messages.ts** — add to `SessionViewModel`:
   `/** For a just-`/clear`-ed empty session, the title/shortId of the prior
     same-cwd session, for continuity. Undefined otherwise. */`
   `clearedFrom?: string;`

2. **session-view-model.ts** — keep the "no activity" + `clear` gate identical to
   Phase 1's `isFresh` logic (extract a tiny shared helper if it avoids drift —
   `hasRealActivity(state)` in a pure module both call). For each qualifying
   session, scan `ordered` for the first different-sessionId entry with the same
   `cwd`; set `clearedFrom = prev.title ?? prev.sessionId.slice(0,8)`.
   Prefer computing a `Map<sessionId, string>` in `toSidebarViewModel` and
   passing the resolved value into `toSessionViewModel` (new optional param),
   over mutating the returned DTOs.

3. **render-vitals.ts** — when `s.clearedFrom` is set, append to the subtitle:
   `` `${subtitle} · cleared from ${esc(s.clearedFrom)}` `` (only in the fresh
   case, so it does not linger once the session has activity).

4. **Typecheck:** `npm run typecheck`.

## Todo List

- [ ] `SessionViewModel.clearedFrom` added
- [ ] `toSidebarViewModel` resolves predecessor by cwd (most-recent other)
- [ ] Shared no-activity gate (no logic drift vs Phase 1)
- [ ] Subtitle shows "cleared from <prev>" only in the fresh case
- [ ] `npm run typecheck` clean
- [ ] **OR** phase consciously cut — recorded in plan.md

## Success Criteria

- Fresh `clear` session with a same-cwd predecessor shows the hint; without a
  predecessor shows none; non-`clear` sessions never show it.
- No regression to Phase 1 behavior; typecheck passes.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Wrong predecessor picked (concurrent same-cwd sessions) | Med | Low | Pick most-recently-updated other same-cwd session; it is a soft hint, not load-bearing. |
| Duplicated no-activity gate drifts from Phase 1 | Med | Low | Extract one shared pure helper; both sites call it. |
| Scope creep into a persistent cwd→session index | Low | Med | Hard stop — if that is needed, cut this phase entirely. |
| Predecessor also empty (double `/clear`) → hint points at another empty card | Low | Low | Acceptable; title/shortId still orients the user. |

## Security Considerations

- `clearedFrom` is a title/shortId already sourced from trusted transcript data
  and rendered via existing `esc()` — no new surface.

## Next Steps

- Feeds into Phase 3 tests (add `toSidebarViewModel` cases) only if this phase is
  built; otherwise skip those cases.
