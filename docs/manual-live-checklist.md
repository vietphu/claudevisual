# ClaudeVisual Phase 6 — Manual Live/E2E Checklist

This document provides a repeatable checklist for testing ClaudeVisual's live behavior when Hooks are installed and StatusLine is wrapped. All steps must be confirmed before the Phase 6 gate passes.

**Setup Required**
- VS Code with ClaudeVisual extension installed (from `npm run compile` + reload)
- A fixture project directory (e.g., `/tmp/claudevisual-test-project`)
- A real `claude` session running in that project (separate terminal)
- Hooks installed via "ClaudeVisual: Install Hooks" command
- StatusLine wrapped via "ClaudeVisual: Wrap StatusLine" command

---

## Success Criteria Walkthrough

### 1. Status Bar Updates Within ~1s of JSONL Append

**Steps:**
1. Open ClaudeVisual sidebar (Activity Bar icon)
2. Observe the "Sessions" tree with an active session listed
3. In the separate terminal, run a `claude` command (e.g., `claude --help`)
4. Watch the status bar at the bottom of VS Code
5. Within ~1 second, confirm:
   - Session appears in the tree (or updates if already present)
   - Token count, model name, and permission mode display correctly
   - "Running" indicator flips to `true` when Claude is processing
   - "Running" indicator flips to `false` after Claude stops

**Expected Behavior:**
- Status bar updates near-instantly (<1s) as new JSONL lines are appended
- No stale or lagging display

**Pass Criteria:** Status updates occur within 1 second of JSONL append.

---

### 2. Tree View Populates Sub-Agent Nodes on a Task Call

**Steps:**
1. From the fixture project, run a `claude` command that spawns a sub-agent, e.g.:
   ```bash
   claude "Use the tester agent to run tests"
   ```
2. Watch the Sessions tree view in the ClaudeVisual sidebar
3. Confirm that:
   - A sub-agent node appears under the active session (e.g., "code-reviewer — running")
   - The sub-agent's agentId is displayed
   - The sub-agent status transitions from "running" to "completed" when the Task result is processed
   - Token count and "last updated" timestamp update correctly

**Expected Behavior:**
- Tree view reflects Task tool_use calls immediately
- Sub-agents appear as child nodes with their type and status
- Status automatically transitions to "completed" when tool_result arrives

**Pass Criteria:** Sub-agent nodes appear in tree view on Task call and status updates on completion.

---

### 3. Install Hooks Flips Running Indicator Faster Than JSONL-Only; Uninstall Hooks Diff is Clean

**Steps:**

#### 3a — Install Hooks Performance
1. Start a session with Hooks NOT installed
2. Run a `claude` command
3. Observe: without Hooks, the "running" indicator only updates when JSONL lines arrive (~2–5s latency)
4. Install Hooks via "ClaudeVisual: Install Hooks" command
5. Run another `claude` command
6. Observe: with Hooks, the "running" indicator flips within ~200–500ms (hook event latency)
7. Confirm the running-indicator is noticeably faster with Hooks

#### 3b — Uninstall Hooks Diff is Clean
1. Uninstall Hooks via "ClaudeVisual: Uninstall Hooks" command
2. Examine `~/.claude/settings.json` diff (e.g., via `git diff` or file comparison)
3. Confirm:
   - Only ClaudeVisual hook entries are removed (SessionStart, UserPromptSubmit, PostToolUse, Stop events)
   - No other hooks are affected
   - The file remains valid JSON and properly formatted
   - Other config fields (permissions, statusLine, plugins) are untouched

**Expected Behavior:**
- Hooks installation is faster than JSONL-only
- Uninstall cleanly removes only ClaudeVisual entries

**Pass Criteria:** Install speeds up running indicator noticeably; uninstall diff is minimal and clean.

---

### 4. Wrap StatusLine Leaves ClaudeKit's Original Output Unchanged; Numbers Match a Manual `cat`

**Steps:**
1. Run a `claude` command to generate statusline output
2. Wrap StatusLine via "ClaudeVisual: Wrap StatusLine" command
3. Run another `claude` command
4. In VS Code terminal, manually inspect the `~/.claude/statusline-cache.json` file:
   ```bash
   cat ~/.claude/statusline-cache.json | jq '.context_window, .cost'
   ```
5. In ClaudeVisual sidebar, observe the displayed:
   - Context window usage (%)
   - Total cost (USD)
6. Confirm:
   - Numbers displayed in ClaudeVisual **exactly match** the `statusline-cache.json` values
   - ClaudeKit's original terminal statusline output is **not modified** — only ClaudeVisual's sidebar shows the wrapped data
   - The cost and context values are precise (not approximations)

**Expected Behavior:**
- Wrapping StatusLine extracts and caches data without modifying ClaudeKit's output
- ClaudeVisual displays accurate, precise metrics

**Pass Criteria:** Sidebar numbers match `statusline-cache.json`; original output unchanged.

---

### 5. Config Field Edit Reflected Correctly with Working Undo

**Steps:**
1. Open VS Code Settings (Cmd+, on macOS)
2. Search for "claudevisual"
3. Toggle the "Debug" setting (claudevisual.debug) on and off
4. Confirm:
   - The setting change is reflected immediately in the extension (e.g., verbose logging starts/stops)
   - No errors in the Extension output panel
5. Undo the setting change (Cmd+Z in the settings editor)
6. Confirm:
   - The setting reverts to its prior state
   - The extension correctly responds to the reverted setting

**Expected Behavior:**
- Config changes are watched and applied without restart
- Undo works correctly and reverts the extension state

**Pass Criteria:** Config edits are reflected immediately; undo works correctly.

---

### 6. Two Sessions in Same CWD Rendered as Separate Siblings (Not Conflated)

**Steps:**
1. Start two separate `claude` sessions in the **same project directory** (same CWD)
2. Open the Sessions tree view in ClaudeVisual
3. Confirm:
   - Both sessions appear as separate nodes (not merged)
   - Each session has its own sessionId
   - Each session tracks its own token count, model, and status independently
   - Toggling one session's sub-agents does not affect the other
   - Running one session does not change the other's "running" indicator

**Expected Behavior:**
- Sessions are identified by sessionId, not CWD
- Multiple sessions in the same project are rendered as siblings

**Pass Criteria:** Two sessions in the same CWD appear as separate nodes with independent state.

---

## Sign-Off

Once all six criteria above have been manually verified in a live environment, mark the Phase 6 gate as **PASSED**.

**Tester Name:** ________________________  
**Date:** ________________________  
**Environment:** ________________________ (e.g., macOS 14.6, VS Code 1.90, ClaudeVisual 0.0.1)  

**Notes:**
