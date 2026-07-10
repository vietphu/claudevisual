import { strict as assert } from "assert";
import {
  EMIT_EVENT_PATH_SUFFIX,
  isOurCommandEntry,
  refreshBundledCommandPaths,
  STATUSLINE_WRAP_PATH_SUFFIX,
} from "../../src/hooks/installer";

/**
 * Covers only the pure, host-independent matching/rebuild helpers behind the
 * version-independent command identity fix — never `installHooks`/
 * `uninstallHooks`/etc. directly, since those hardcode
 * `defaultClaudeSettingsPath()` (`~/.claude/settings.json`) with no way to
 * redirect it to a temp file in tests; exercising them here would mutate a
 * real user's global Claude Code config.
 */
describe("installer command matching", () => {
  describe("isOurCommandEntry", () => {
    it("matches a command built from the current extensionPath", () => {
      const command = `bash "/Users/dev/.vscode/extensions/claudevisual-0.0.1/dist/hook-scripts/runner.sh" "/Users/dev/.vscode/extensions/claudevisual-0.0.1/${EMIT_EVENT_PATH_SUFFIX}"`;
      assert.equal(isOurCommandEntry({ command }), true);
    });

    it("still matches a command built from a stale (since-deleted) extensionPath", () => {
      // Simulates a VS Code auto-update: the extension moved from
      // .../claudevisual-0.0.1/ to .../claudevisual-0.0.2/, deleting the old
      // directory — the recorded command's absolute prefix is now dangling,
      // but the trailing dist/hook-scripts/emit-event.cjs segment is stable.
      const command = `bash "/Users/dev/.vscode/extensions/claudevisual-0.0.1/dist/hook-scripts/runner.sh" "/Users/dev/.vscode/extensions/claudevisual-0.0.1/${EMIT_EVENT_PATH_SUFFIX}"`;
      assert.equal(isOurCommandEntry({ command }), true);
    });

    it("does not match an unrelated hook command", () => {
      assert.equal(isOurCommandEntry({ command: "node /some/other/scout-block.cjs" }), false);
    });

    it("does not match a malformed/missing entry", () => {
      assert.equal(isOurCommandEntry(undefined), false);
      assert.equal(isOurCommandEntry({}), false);
      assert.equal(isOurCommandEntry({ command: 42 }), false);
    });
  });

  describe("refreshBundledCommandPaths", () => {
    it("rebuilds the two leading paths against a new extensionPath, direct-install shape (no trailing arg)", () => {
      const stale = `bash "/old/ext/dist/hook-scripts/runner.sh" "/old/ext/${STATUSLINE_WRAP_PATH_SUFFIX}"`;
      const refreshed = refreshBundledCommandPaths(
        stale,
        "/new/ext/dist/hook-scripts/runner.sh",
        `/new/ext/${STATUSLINE_WRAP_PATH_SUFFIX}`
      );
      assert.equal(refreshed, `bash "/new/ext/dist/hook-scripts/runner.sh" "/new/ext/${STATUSLINE_WRAP_PATH_SUFFIX}"`);
    });

    it("preserves a trailing shell-quoted original command verbatim (wrap shape)", () => {
      const stale =
        `bash "/old/ext/dist/hook-scripts/runner.sh" "/old/ext/${STATUSLINE_WRAP_PATH_SUFFIX}" ` +
        `'node /some/other/statusline.js --flag \\'quoted\\''`;
      const refreshed = refreshBundledCommandPaths(
        stale,
        "/new/ext/dist/hook-scripts/runner.sh",
        `/new/ext/${STATUSLINE_WRAP_PATH_SUFFIX}`
      );
      assert.equal(
        refreshed,
        `bash "/new/ext/dist/hook-scripts/runner.sh" "/new/ext/${STATUSLINE_WRAP_PATH_SUFFIX}" ` +
          `'node /some/other/statusline.js --flag \\'quoted\\''`
      );
    });

    it("is a no-op when the command already points at the given paths", () => {
      const current = `bash "/new/ext/dist/hook-scripts/runner.sh" "/new/ext/${STATUSLINE_WRAP_PATH_SUFFIX}"`;
      assert.equal(
        refreshBundledCommandPaths(current, "/new/ext/dist/hook-scripts/runner.sh", `/new/ext/${STATUSLINE_WRAP_PATH_SUFFIX}`),
        current
      );
    });

    it("returns the input unchanged if it doesn't match the expected bash-two-quoted-args shape", () => {
      const unexpected = "node /some/script.js";
      assert.equal(refreshBundledCommandPaths(unexpected, "/new/runner.sh", "/new/script.cjs"), unexpected);
    });
  });
});
