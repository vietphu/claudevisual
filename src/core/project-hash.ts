import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Mirrors Claude Code's own cwd -> project-directory-name transform: every
 * non-alphanumeric character (including `/` and `.`) becomes `-`, one-for-one,
 * with no collapsing of consecutive dashes. Verified against real directories
 * under ~/.claude/projects/ (e.g. "/Users/x/.claude-mem-observer-sessions" ->
 * "-Users-x--claude-mem-observer-sessions").
 */
export function cwdToProjectHash(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

export function claudeProjectsRoot(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

export function projectDirForCwd(cwd: string): string {
  return path.join(claudeProjectsRoot(), cwdToProjectHash(cwd));
}

export function claudeSessionsRoot(): string {
  return path.join(os.homedir(), ".claude", "sessions");
}

/**
 * Resolves symlinks (e.g. macOS `/tmp` vs `/private/tmp`) so cwd strings from
 * different sources (VS Code workspace folders, the session registry) can be
 * compared for equality reliably. Falls back to a plain `path.resolve` if the
 * path doesn't exist / can't be resolved.
 */
export function normalizeCwd(cwd: string): string {
  try {
    return fs.realpathSync(cwd);
  } catch {
    return path.resolve(cwd);
  }
}
