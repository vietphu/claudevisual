#!/usr/bin/env node
"use strict";

/**
 * Bundled Claude Code `statusLine.command` wrapper — zero npm dependencies
 * (Node.js builtins only), invoked via `runner.sh` exactly like
 * `emit-event.cjs`, so it runs standalone from `dist/hook-scripts/` without
 * being part of the extension's own bundle.
 *
 * Installed opt-in by `../installer.ts` (`wrapStatusLine`/`installStatusLineDirect`)
 * as the new value of `statusLine.command` in `~/.claude/settings.json`. Two modes,
 * selected by whether an original command was captured at install time:
 *
 *  - Wrap mode (`process.argv[2]` set to the previously-configured command):
 *    tee stdin to `~/.claude/claudevisual/statusline-cache.json`, then spawn the
 *    original command with the same stdin and forward its stdout unchanged — the
 *    user's existing statusline renders exactly as before.
 *  - Direct-install mode (no original command, `statusLine` was empty/absent):
 *    tee stdin to the same cache file, then print a minimal summary line built
 *    from the payload itself.
 *
 * MUST fail open: Claude Code calls this on every statusline refresh tick. Any
 * uncaught exception, hung child process, or write failure must never leave the
 * statusline blank — every failure path below falls through to a non-empty
 * fallback line and this always exits 0.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

/** Upper bound on the original command's runtime — a safety net so a hung or
 *  slow third-party statusline command can never stall Claude Code's own
 *  statusline tick indefinitely. Generous relative to any well-behaved
 *  statusline script, which should render in well under a second. */
const ORIGINAL_COMMAND_TIMEOUT_MS = 8000;
const MAX_ORIGINAL_OUTPUT_BYTES = 1024 * 1024;

/** Reads the full statusline stdin payload as raw bytes — never assumes it's
 *  valid JSON here, since the cache tee below must preserve it verbatim. */
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function statuslineCachePaths() {
  const dir = path.join(os.homedir(), ".claude", "claudevisual");
  return { dir, filePath: path.join(dir, "statusline-cache.json") };
}

/**
 * Single O(1) small-file atomic overwrite: write-to-temp then rename over the
 * target. Never reads the existing cache file back — no read-modify-write on
 * this hot path. Best-effort: a cache write failure must never block the
 * original command from still running and rendering below.
 */
function writeCacheVerbatim(raw) {
  if (raw.length === 0) {
    return;
  }
  const { dir, filePath } = statuslineCachePaths();
  try {
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = path.join(dir, `.statusline-cache.tmp-${process.pid}-${Date.now()}`);
    fs.writeFileSync(tmpPath, raw);
    fs.renameSync(tmpPath, filePath);
  } catch {
    // Fail open — see module doc comment.
  }
}

/** Builds a minimal, always-non-empty status line from the raw stdin payload,
 *  used both for direct-install mode and as the fail-open fallback when
 *  wrapping an original command that errored or produced no output. */
function buildFallbackLine(raw) {
  try {
    const payload = JSON.parse(raw.toString("utf8"));
    const parts = ["ClaudeVisual"];

    const modelName = payload && payload.model && (payload.model.display_name || payload.model.id);
    if (typeof modelName === "string" && modelName.length > 0) {
      parts.push(modelName);
    }

    const contextPercent = payload && payload.context_window && payload.context_window.used_percentage;
    if (typeof contextPercent === "number" && Number.isFinite(contextPercent)) {
      parts.push(`ctx ${Math.round(contextPercent)}%`);
    }

    const costUsd = payload && payload.cost && payload.cost.total_cost_usd;
    if (typeof costUsd === "number" && Number.isFinite(costUsd)) {
      parts.push(`$${costUsd.toFixed(2)}`);
    }

    return parts.join(" · ");
  } catch {
    return "ClaudeVisual";
  }
}

/**
 * Spawns the captured original `statusLine.command` through a shell (matching
 * how Claude Code itself invokes `statusLine.command` strings that reference
 * shell syntax like `$HOME` expansion), forwarding the same stdin bytes this
 * script received. Returns `undefined` — never throws — on any failure mode
 * (missing/non-zero exit, timeout, empty output) so the caller always has a
 * clean fail-open fallback path.
 */
function runOriginalCommand(command, stdinBuffer) {
  if (typeof command !== "string" || command.trim().length === 0) {
    return undefined;
  }
  try {
    const result = spawnSync(command, {
      shell: true,
      input: stdinBuffer,
      encoding: "utf8",
      timeout: ORIGINAL_COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_ORIGINAL_OUTPUT_BYTES,
    });
    if (result.error || typeof result.status === "number" && result.status !== 0) {
      return undefined;
    }
    const stdout = result.stdout;
    return typeof stdout === "string" && stdout.trim().length > 0 ? stdout : undefined;
  } catch {
    return undefined;
  }
}

async function main() {
  const stdinBuffer = await readStdin();

  // Tee first, unconditionally — independent of whether the original command
  // (if any) below succeeds. This is the precise context%/cost source
  // `../../core/event-log-reader.ts` tails.
  writeCacheVerbatim(stdinBuffer);

  const originalCommand = process.argv[2];
  const originalOutput = runOriginalCommand(originalCommand, stdinBuffer);
  if (originalOutput !== undefined) {
    process.stdout.write(originalOutput.endsWith("\n") ? originalOutput : `${originalOutput}\n`);
    return;
  }

  process.stdout.write(`${buildFallbackLine(stdinBuffer)}\n`);
}

main()
  .catch(() => {
    // Last-resort fail-open — see module doc comment.
    process.stdout.write("ClaudeVisual\n");
  })
  .finally(() => {
    process.exit(0);
  });
