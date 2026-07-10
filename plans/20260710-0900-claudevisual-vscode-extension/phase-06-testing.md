# Phase 6 — Testing

## Context Links
- Overview: [plan.md](plan.md) · Depends on: [Phase 1](phase-01-jsonl-baseline.md)–[Phase 5](phase-05-webview-charts-config.md)
  (unit scaffolding for pure functions can start earlier)

## Overview
- **Priority:** High (correctness gate before packaging; protects the safe-write guarantees).
- **Status:** Not Started
- **Description:** Two tiers — automated unit tests for pure functions (parser/reducer/merge/hash),
  and a documented manual live/E2E checklist for the hook/statusline/config paths (not automated in v1).

## Key Insights
- Unit tier needs neither VS Code nor Claude Code running — pure functions only.
- Fixtures must be shaped **exactly like real captured lines**: assistant lines with nested
  `iterations[]`, `mode` lines, Task tool_use with `subagent_type`.
- `json-merge.test.ts` must run against a **sanitized copy of this machine's actual hooks/statusLine
  settings.json shape** to catch regressions in the array-append-not-replace guarantee.
- Live hook path is not automated in v1 — a repeatable manual checklist is the accepted v1 approach.

## Requirements
**Functional — Unit tier (Mocha, `@vscode/test-electron` harness for TS)**
- `transcript-parser.test.ts` — real-shaped fixture lines incl. unknown types (log-and-skip, no throw).
- `state-reducer.test.ts` — `iterations[]` summing + fallback; `mode` handling; Task→sub-agent.
- `project-hash.test.ts` — workspaceFolder → hash path mapping.
- `json-merge.test.ts` — against sanitized real settings.json: append-not-replace, backup, rollback.

**Functional — Live/E2E tier (manual, documented checklist)**
- Extension Development Host (F5) against a fixture project + a real `claude` session in a separate terminal.

**Non-functional**
- Unit suite runs in CI and locally. No fake data that hides real-shape regressions.

## Architecture
```
Unit tier:  fixtures/*.jsonl (real-shaped) ──▶ pure fns ──▶ assertions   (no VS Code / Claude runtime)
            sanitized settings.json copy ──▶ json-merge ──▶ assert array-append + rollback
Live tier:  F5 Dev Host + real claude session ──▶ manual checklist walkthrough (documented)
```

## Related Code Files
**Create**
- `test/suite/transcript-parser.test.ts`
- `test/suite/state-reducer.test.ts`
- `test/suite/project-hash.test.ts`
- `test/suite/json-merge.test.ts`
- `test/fixtures/*.jsonl` — real-shaped transcript fixtures (assistant+iterations, mode, Task tool_use).
- `test/fixtures/settings-sanitized.json` — sanitized copy of this machine's hooks/statusLine shape.
- `docs/manual-live-checklist.md` — repeatable end-to-end manual test checklist.

**Modify**
- `package.json` — test scripts + `@vscode/test-electron` + Mocha devDeps.

**Delete** — none.

## Implementation Steps
1. Capture/sanitize real-shaped fixture JSONL lines and a sanitized settings.json copy.
2. Wire `@vscode/test-electron` + Mocha; add `npm test` script.
3. Write `transcript-parser.test.ts` (incl. unknown-type tolerance).
4. Write `state-reducer.test.ts` (iterations summing + fallback; mode; Task→sub-agent).
5. Write `project-hash.test.ts`.
6. Write `json-merge.test.ts` against sanitized settings.json (append-not-replace, backup, rollback).
7. Author `docs/manual-live-checklist.md` covering the live steps in Success Criteria.
8. Walk the manual checklist once end-to-end; confirm every step.

## Todo List
- [ ] Real-shaped fixtures + sanitized settings.json
- [ ] Test harness (`@vscode/test-electron` + Mocha) + npm script
- [ ] `transcript-parser.test.ts`
- [ ] `state-reducer.test.ts`
- [ ] `project-hash.test.ts`
- [ ] `json-merge.test.ts` (sanitized real shape)
- [ ] `docs/manual-live-checklist.md`
- [ ] Manual live checklist walked once, all steps confirmed

## Success Criteria
Unit suite passes in CI/locally, AND the manual live checklist has been walked through once
end-to-end with all steps confirmed:
- status bar updates within ~1s of JSONL append
- tree view populates sub-agent nodes on a Task call
- Install Hooks flips running-indicator faster than JSONL-only; Uninstall Hooks diff is clean
- Wrap StatusLine leaves ClaudeKit's original output unchanged; numbers match a manual `cat` of the statusline JSON
- config field edit reflected correctly with working Undo
- two-sessions-same-cwd rendered as separate siblings, not conflated

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Fixtures drift from real shape → false confidence | Med | High | Capture from real transcripts; incl. iterations[]/mode/Task cases. |
| json-merge regression clobbers real settings | Low | High | Test against sanitized real settings.json shape specifically. |
| Live path untested (no v1 automation) | Med | Med | Documented repeatable manual checklist; walked once before packaging. |
| Flaky electron test harness | Low | Med | Keep unit tier pure (no VS Code runtime dependence where avoidable). |

## Security Considerations
- Fixtures and sanitized settings.json must contain **no** real secrets/API keys/credentials — sanitize before committing.
- Do not commit real transcript bodies; use minimal representative fixture lines only.

## Next Steps
- Green unit suite + confirmed checklist gate Phase 7 packaging.
