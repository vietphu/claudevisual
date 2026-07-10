import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * EMPIRICAL VERIFICATION (Phase 5 open question — settings precedence):
 *
 * Question: does Claude Code fully override or deep-merge project-level
 * settings.json over global (`~/.claude/settings.json`), per key?
 *
 * Finding: PER-KEY SCALAR OVERRIDE, not whole-file replace and not a
 * recursive deep-merge of nested objects either. Verified against Claude
 * Code's own published settings documentation (code.claude.com/docs/en/settings,
 * "Settings precedence" section, fetched 2026-07-10):
 *
 *   "When the same setting appears in multiple scopes, Claude Code applies
 *    them in priority order: 1. Managed (highest) 2. Command line arguments
 *    3. Local — overrides project and user settings 4. Project — overrides
 *    user settings 5. User (lowest) — applies when nothing else specifies
 *    the setting."
 *
 *   "For example, if your user settings set `spinnerTipsEnabled` to `true`
 *    and project settings set it to `false`, the project value applies."
 *    (scalar override, resolved independently per key — a key ABSENT from
 *    the project file still falls through to the user/global value; the
 *    project file does not need to repeat every key to "win".)
 *
 * The one documented exception is array-typed fields (e.g.
 * `permissions.allow`), which are concatenated + deduplicated across scopes
 * rather than overridden — this module's `readEffectiveValue` is only used
 * for the scalar/enum fields this extension's config form edits (`model`,
 * `effortLevel`, `permissions.defaultMode`), so scalar-override semantics
 * apply directly: read project's value for the key if present, else fall
 * back to global's value for that same key.
 *
 * This resolves the phase's open question in favor of "per-key override"
 * (the assumption the phase file flagged as its best-supported guess) — not
 * a deep-merge of the two settings.json documents as a whole.
 *
 * Caveat found during the same research pass: there is a known, tracked bug
 * (anthropics/claude-code#19487) where project-level `settings.local.json`
 * can fully replace — rather than per-key override — global
 * `settings.local.json`. That bug is specific to the separate `.local.json`
 * file this extension never reads or writes (`config-writer.ts` only ever
 * targets `settings.json`, matching the hooks/statusline installers), so it
 * doesn't change the resolution logic below.
 */

export type SettingsScope = "global" | "project";

export interface SettingsScopePaths {
  global: string;
  /** `undefined` when no workspace folder is open — project scope unavailable. */
  project: string | undefined;
}

export function resolveSettingsPaths(workspaceRoot: string | undefined): SettingsScopePaths {
  return {
    global: path.join(os.homedir(), ".claude", "settings.json"),
    project: workspaceRoot ? path.join(workspaceRoot, ".claude", "settings.json") : undefined,
  };
}

/** Resolves the concrete file path for one scope. Throws if `"project"` is
 *  requested with no workspace folder open — callers (config-writer.ts) must
 *  not silently fall back to global when the user explicitly picked project. */
export function settingsPathForScope(paths: SettingsScopePaths, scope: SettingsScope): string {
  if (scope === "project") {
    if (!paths.project) {
      throw new Error("no workspace folder open — cannot resolve project-scope settings.json path");
    }
    return paths.project;
  }
  return paths.global;
}

async function readJsonFileOrUndefined(filePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const content = await fs.promises.readFile(filePath, "utf8");
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // Missing file or malformed JSON — treated as "nothing set" for this
    // read-only effective-value peek. The actual write path (config-writer.ts,
    // via json-merge.ts) surfaces malformed JSON as a hard error instead.
    return undefined;
  }
}

/** Reads the value at a dot-separated key path (e.g. `"permissions.defaultMode"`).
 *  Returns `undefined` if any intermediate segment is missing or not a plain object. */
export function getByPath(data: Record<string, unknown> | undefined, keyPath: string): unknown {
  if (!data) {
    return undefined;
  }
  let cursor: unknown = data;
  for (const segment of keyPath.split(".")) {
    if (typeof cursor !== "object" || cursor === null || Array.isArray(cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/** Sets the value at a dot-separated key path, creating intermediate plain
 *  objects as needed. Overwrites a non-object intermediate segment with `{}`
 *  rather than throwing — the config form only ever writes to the small,
 *  known field set in settings-schema.ts, so this is never reached against
 *  unexpected user data without the caller already knowing the field's shape. */
export function setByPath(data: Record<string, unknown>, keyPath: string, value: unknown): void {
  const segments = keyPath.split(".");
  let cursor: Record<string, unknown> = data;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    const existing = cursor[segment];
    if (typeof existing !== "object" || existing === null || Array.isArray(existing)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]] = value;
}

export interface EffectiveValue {
  value: unknown;
  /** `undefined` means the key is set in neither scope. */
  scope: SettingsScope | undefined;
}

/**
 * Resolves the effective value of one field per the per-key scalar-override
 * semantics verified above: project's value for `keyPath` wins if present,
 * else global's value, else unset. Read-only — never used on the write path.
 */
export async function readEffectiveValue(paths: SettingsScopePaths, keyPath: string): Promise<EffectiveValue> {
  if (paths.project) {
    const projectData = await readJsonFileOrUndefined(paths.project);
    const projectValue = getByPath(projectData, keyPath);
    if (projectValue !== undefined) {
      return { value: projectValue, scope: "project" };
    }
  }
  const globalData = await readJsonFileOrUndefined(paths.global);
  const globalValue = getByPath(globalData, keyPath);
  if (globalValue !== undefined) {
    return { value: globalValue, scope: "global" };
  }
  return { value: undefined, scope: undefined };
}
