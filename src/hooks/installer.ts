import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ensureArray, ensureObject, JsonMergeError, mergeJsonFile } from "./json-merge";

/**
 * Every Claude Code lifecycle event ClaudeVisual's low-latency running
 * overlay cares about. Matches `hookEvent` values `emit-event.cjs` writes
 * and `deriveRunningState` in `../core/event-log-reader.ts` interprets —
 * keep the three in sync.
 */
const HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "SubagentStart",
  "SubagentStop",
  "SessionStart",
  "UserPromptSubmit",
  "Stop",
] as const;

/** Generous relative to `emit-event.cjs`'s actual O(1)-append runtime — just
 *  a ceiling against a pathologically slow `node` cold-start, never hit in
 *  the common case. */
const HOOK_TIMEOUT_SECONDS = 10;

interface HookCommandEntry {
  type?: string;
  command?: string;
  timeout?: number;
  [key: string]: unknown;
}

interface HookGroup {
  matcher?: string;
  hooks: HookCommandEntry[];
  [key: string]: unknown;
}

export interface HookInstallResult {
  settingsPath: string;
  backupPath: string | undefined;
  /** Events newly wired this call — events that already had our entry are skipped (idempotent). */
  installedEvents: string[];
  /** Top-level `settings.json` key this call wrote to — always `"hooks"`.
   *  Paired with `contentHash` so `config-form.ts` can build an Undo record. */
  keyPath: string;
  /** SHA-256 fingerprint of the file's bytes immediately after this write —
   *  `mergeJsonFile`'s `contentHash`, always populated since this call always
   *  performs a write (see `json-merge.ts`). */
  contentHash: string;
}

export interface HookUninstallResult {
  settingsPath: string;
  backupPath: string | undefined;
  /** Total individual hook command entries removed across every event. */
  removedCount: number;
  keyPath: string;
  contentHash: string;
}

export function defaultClaudeSettingsPath(): string {
  return path.join(os.homedir(), ".claude", "settings.json");
}

function bundledEmitEventPath(extensionPath: string): string {
  return path.join(extensionPath, "dist", "hook-scripts", "emit-event.cjs");
}

function bundledRunnerPath(extensionPath: string): string {
  return path.join(extensionPath, "dist", "hook-scripts", "runner.sh");
}

function bundledStatuslineWrapPath(extensionPath: string): string {
  return path.join(extensionPath, "dist", "hook-scripts", "statusline-wrap.cjs");
}

/**
 * Version-independent identity markers for "is this command entry ours".
 * `extensionPath` is version-numbered and changes on every VS Code
 * auto-update (the old install directory is deleted), but the bundled
 * `dist/hook-scripts/*` layout beneath it is stable across versions — so
 * matching on this trailing path segment (rather than the full absolute
 * `extensionPath`-prefixed path) keeps recognizing an entry we installed
 * even after an update moves `extensionPath` out from under it. Exported for
 * unit testing; pure string operations, no filesystem/vscode dependency.
 */
export const EMIT_EVENT_PATH_SUFFIX = path.join("dist", "hook-scripts", "emit-event.cjs");
export const STATUSLINE_WRAP_PATH_SUFFIX = path.join("dist", "hook-scripts", "statusline-wrap.cjs");

function buildCommand(extensionPath: string): string {
  const runnerPath = bundledRunnerPath(extensionPath);
  const emitEventPath = bundledEmitEventPath(extensionPath);
  return `bash "${runnerPath}" "${emitEventPath}"`;
}

function isHookGroup(value: unknown): value is HookGroup {
  return typeof value === "object" && value !== null && Array.isArray((value as HookGroup).hooks);
}

/** `true` if `entry.command` references our bundled `emit-event.cjs`,
 *  regardless of which `extensionPath` it was built against (see
 *  {@link EMIT_EVENT_PATH_SUFFIX}). */
export function isOurCommandEntry(entry: unknown): boolean {
  return (
    typeof entry === "object" &&
    entry !== null &&
    typeof (entry as HookCommandEntry).command === "string" &&
    (entry as HookCommandEntry).command!.includes(EMIT_EVENT_PATH_SUFFIX)
  );
}

function groupHasOurCommand(group: unknown): boolean {
  return isHookGroup(group) && group.hooks.some((entry) => isOurCommandEntry(entry));
}

/**
 * Appends one matcher-group invoking our bundled `runner.sh emit-event.cjs`
 * to each `hooks.<Event>` array in `~/.claude/settings.json`, for every
 * event in {@link HOOK_EVENTS}. Never replaces or clears an existing array —
 * only pushes/replaces our own group — so pre-existing hooks (e.g.
 * `scout-block.cjs`, `privacy-block.cjs`) are left byte-for-byte untouched.
 * Idempotent: an event whose entry already matches the command this call
 * would write is left alone. If an event instead has a *stale* entry (ours,
 * but built against a since-deleted `extensionPath` from a prior VS Code
 * version — recognized via {@link EMIT_EVENT_PATH_SUFFIX}, independent of
 * that old path), that group is replaced in place with the current command
 * rather than appending a duplicate group alongside the broken one.
 */
export async function installHooks(extensionPath: string): Promise<HookInstallResult> {
  const settingsPath = defaultClaudeSettingsPath();
  const command = buildCommand(extensionPath);
  const installedEvents: string[] = [];

  const result = await mergeJsonFile(settingsPath, (data) => {
    const hooksObj = ensureObject(data, "hooks");
    for (const event of HOOK_EVENTS) {
      const eventArray = ensureArray(hooksObj, event);
      const newGroup: HookGroup = {
        matcher: "*",
        hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT_SECONDS }],
      };
      const staleIndex = eventArray.findIndex((group) => groupHasOurCommand(group));
      if (staleIndex === -1) {
        eventArray.push(newGroup);
        installedEvents.push(event);
        continue;
      }
      const staleGroup = eventArray[staleIndex] as HookGroup;
      const alreadyCurrent = staleGroup.hooks.some(
        (entry) => isOurCommandEntry(entry) && (entry as HookCommandEntry).command === command
      );
      if (alreadyCurrent) {
        continue; // already installed with today's extensionPath — no-op
      }
      eventArray[staleIndex] = newGroup; // replace the stale (old-extensionPath) entry in place
      installedEvents.push(event);
    }
  });

  return {
    settingsPath,
    backupPath: result.backupPath,
    installedEvents,
    keyPath: "hooks",
    contentHash: result.contentHash,
  };
}

/**
 * Removes only the hook command entries whose `command` references our
 * bundled `emit-event.cjs` path from every `hooks.<Event>` array in
 * `~/.claude/settings.json`, regardless of which `extensionPath` they were
 * installed with ({@link EMIT_EVENT_PATH_SUFFIX} matches across versions, so
 * an orphaned entry from a prior VS Code auto-update is still found). A
 * matcher-group is dropped entirely only once every entry inside it was
 * ours; groups that mix our entry with unrelated ones keep their other
 * entries. Every pre-existing hook is left intact.
 */
export async function uninstallHooks(): Promise<HookUninstallResult> {
  const settingsPath = defaultClaudeSettingsPath();
  let removedCount = 0;

  const result = await mergeJsonFile(settingsPath, (data) => {
    const hooksValue = data["hooks"];
    if (typeof hooksValue !== "object" || hooksValue === null || Array.isArray(hooksValue)) {
      return; // no hooks object at all — nothing to remove
    }
    const hooksObj = hooksValue as Record<string, unknown>;

    for (const event of Object.keys(hooksObj)) {
      const eventArray = hooksObj[event];
      if (!Array.isArray(eventArray)) {
        continue;
      }
      const nextArray: unknown[] = [];
      for (const group of eventArray) {
        if (!isHookGroup(group)) {
          nextArray.push(group);
          continue;
        }
        const before = group.hooks.length;
        const remainingHooks = group.hooks.filter((entry) => !isOurCommandEntry(entry));
        removedCount += before - remainingHooks.length;
        if (remainingHooks.length === 0) {
          continue; // drop the whole group — it only ever contained our entry
        }
        nextArray.push(remainingHooks.length === before ? group : { ...group, hooks: remainingHooks });
      }
      hooksObj[event] = nextArray;
    }
  });

  return { settingsPath, backupPath: result.backupPath, removedCount, keyPath: "hooks", contentHash: result.contentHash };
}

/**
 * Read-only peek: `true` if any `hooks.<Event>` array already contains our
 * bundled `emit-event.cjs` command entry, from any `extensionPath` version.
 * Never mutates, never backs up — mirrors `readCurrentStatusLine`'s
 * best-effort "treat malformed/missing as false" semantics. Used only to
 * seed the dashboard's hooks-install toggle with its current on/off state
 * (Phase 5, `ui/webview/config-form.ts`).
 */
export async function areHooksInstalled(): Promise<boolean> {
  const settingsPath = defaultClaudeSettingsPath();
  try {
    const content = await fs.promises.readFile(settingsPath, "utf8");
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      return false;
    }
    const data = JSON.parse(trimmed) as Record<string, unknown>;
    const hooksValue = data["hooks"];
    if (typeof hooksValue !== "object" || hooksValue === null || Array.isArray(hooksValue)) {
      return false;
    }
    const hooksObj = hooksValue as Record<string, unknown>;
    return HOOK_EVENTS.some((event) => {
      const eventArray = hooksObj[event];
      return Array.isArray(eventArray) && eventArray.some((group) => groupHasOurCommand(group));
    });
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// StatusLine opt-in wrap
//
// `settings.json`'s `statusLine` is a single `{type, command, padding,
// refreshInterval}` object, not an array — only one command can ever be
// registered. Unlike the hooks arrays above (which only ever append), this
// section must NEVER silently overwrite an already-set `statusLine`: it can
// only be left empty (direct install), wrapped (opt-in, original preserved),
// or restored back to exactly what it was.
// ---------------------------------------------------------------------------

/** Shape of `settings.json`'s `statusLine` value. `[key: string]: unknown`
 *  preserves any fields this extension doesn't know about across a wrap/restore
 *  round-trip (forward compatible with future statusLine config keys). */
export interface StatusLineConfig {
  type?: string;
  command?: string;
  padding?: number;
  refreshInterval?: number;
  [key: string]: unknown;
}

/** Narrowed view of {@link StatusLineConfig} guaranteed to carry a non-empty
 *  `command` — the shape `detectStatusLine` returns once it has already ruled
 *  out the "empty" case. */
interface StatusLineConfigWithCommand extends StatusLineConfig {
  command: string;
}

/**
 * Minimal structural subset of `vscode.ExtensionContext.globalState`
 * (`vscode.Memento`) this module needs. Declared locally rather than
 * importing `vscode` — keeps the hooks/statusline install logic a pure,
 * host-independent module, consistent with the rest of this file, and
 * testable without a running VS Code instance. A real `vscode.Memento`
 * satisfies this interface structurally.
 */
export interface GlobalStateLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

/** Persisted in `globalState` (never `settings.json`) so "Restore Original
 *  StatusLine" is authoritative and byte-for-byte, independent of any later
 *  settings.json mutation by this extension or anything else. */
interface StoredOriginalStatusLine {
  /** `false` when `statusLine` was absent/empty at wrap/install time — restore
   *  means deleting the key entirely, not writing back an empty object. */
  existed: boolean;
  value: StatusLineConfig | undefined;
}

const ORIGINAL_STATUSLINE_STATE_KEY = "claudevisual.statusLine.original";

export type StatusLineDetection =
  | { kind: "empty" }
  | { kind: "already-wrapped"; current: StatusLineConfigWithCommand }
  | { kind: "foreign"; current: StatusLineConfigWithCommand };

export interface StatusLinePreview {
  detection: StatusLineDetection;
  /** `undefined` only when `detection.kind === "empty"`. */
  before: StatusLineConfig | undefined;
  after: StatusLineConfig;
}

export interface StatusLineInstallResult {
  settingsPath: string;
  backupPath: string | undefined;
  installed: boolean;
  keyPath: string;
  contentHash: string;
}

export interface StatusLineWrapResult {
  settingsPath: string;
  backupPath: string | undefined;
  wrapped: boolean;
  /** `true` if `statusLine` already pointed at our wrap script — idempotent no-op. */
  alreadyWrapped: boolean;
  keyPath: string;
  /** `undefined` only for the true no-op case: already wrapped with today's
   *  `extensionPath` and nothing was written. Every other path (a fresh wrap,
   *  or an in-place refresh of a stale `extensionPath`) always writes and
   *  always populates this. */
  contentHash: string | undefined;
}

export interface StatusLineRestoreResult {
  settingsPath: string;
  backupPath: string | undefined;
  /** `false` when there was nothing in `globalState` to restore from — never installed/wrapped, or already restored. */
  restored: boolean;
  keyPath: string;
  /** `undefined` when `restored` is `false` — nothing was written. */
  contentHash: string | undefined;
}

function buildStatusLineDirectCommand(extensionPath: string): string {
  const runnerPath = bundledRunnerPath(extensionPath);
  const wrapPath = bundledStatuslineWrapPath(extensionPath);
  return `bash "${runnerPath}" "${wrapPath}"`;
}

function buildStatusLineWrapCommand(extensionPath: string, originalCommand: string): string {
  const runnerPath = bundledRunnerPath(extensionPath);
  const wrapPath = bundledStatuslineWrapPath(extensionPath);
  return `bash "${runnerPath}" "${wrapPath}" ${shellSingleQuote(originalCommand)}`;
}

/** Single-quotes a shell argument, escaping embedded single quotes with the
 *  standard `'...'\''...'` technique — keeps the captured original command's
 *  own `$VAR`/quoting syntax un-expanded by the outer shell that invokes our
 *  wrap script, so it's expanded correctly (once) when `statusline-wrap.cjs`
 *  re-invokes it through its own shell. */
function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** `true` if `command` invokes our bundled `statusline-wrap.cjs`, regardless
 *  of which `extensionPath` it was built against (see
 *  {@link STATUSLINE_WRAP_PATH_SUFFIX}) — covers both "wrapped an existing
 *  foreign command" and "installed directly" (`buildStatusLineDirectCommand`
 *  also invokes the wrap script, just with no inner command to wrap). */
function isOurStatuslineWrapCommand(command: string | undefined): boolean {
  return typeof command === "string" && command.includes(STATUSLINE_WRAP_PATH_SUFFIX);
}

/** Matches the shape every command this module writes to `statusLine.command`
 *  follows: `bash "<runnerPath>" "<scriptPath>" [<rest>]`, where `<rest>` is
 *  the shell-quoted original command a wrap embeds (absent for a direct
 *  install). Captures `<rest>` verbatim so {@link refreshBundledCommandPaths}
 *  can rebuild just the two leading `extensionPath`-derived paths against a
 *  new `extensionPath` without disturbing anything after them. Exported for
 *  unit testing; pure string operation. */
export const BUNDLED_COMMAND_RE = /^bash\s+"[^"]+"\s+"[^"]+"(\s+.*)?$/;

/**
 * Rebuilds `existingCommand`'s two leading `runnerPath`/`scriptPath`
 * segments against the given (current) paths, preserving everything after
 * them verbatim. Used to repair a `statusLine.command` that was written by a
 * prior VS Code extension version — recognized as "ours" via
 * {@link STATUSLINE_WRAP_PATH_SUFFIX} even though its embedded absolute
 * paths point at a since-deleted `extensionPath` — without needing to
 * re-parse/re-derive whatever original command it may have wrapped. Returns
 * `existingCommand` unchanged if it doesn't match the expected shape (should
 * not happen for a command `isOurStatuslineWrapCommand` already matched, but
 * fail safe rather than corrupt an unexpected value).
 */
export function refreshBundledCommandPaths(existingCommand: string, runnerPath: string, scriptPath: string): string {
  const match = BUNDLED_COMMAND_RE.exec(existingCommand);
  if (!match) {
    return existingCommand;
  }
  const rest = match[1] ?? "";
  return `bash "${runnerPath}" "${scriptPath}"${rest}`;
}

/** Read-only peek at `settings.json`'s current `statusLine` value. Never
 *  mutates, never backs up — a missing file or malformed JSON is treated the
 *  same as "no statusLine set" for detection purposes only (the actual
 *  install/wrap/restore paths below go through `mergeJsonFile`, which does
 *  throw on malformed JSON). */
async function readCurrentStatusLine(settingsPath: string): Promise<StatusLineConfig | undefined> {
  try {
    const content = await fs.promises.readFile(settingsPath, "utf8");
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    const data = JSON.parse(trimmed) as Record<string, unknown>;
    const statusLine = data["statusLine"];
    if (typeof statusLine !== "object" || statusLine === null || Array.isArray(statusLine)) {
      return undefined;
    }
    return statusLine as StatusLineConfig;
  } catch {
    return undefined;
  }
}

/**
 * Classifies the current `statusLine` so callers (the three commands below)
 * know which action is safe to offer: `empty` → direct install is safe;
 * `already-wrapped` → wrapping again would be a no-op (or, if built against a
 * stale `extensionPath`, an in-place refresh); `foreign` → an unrelated
 * command is set and can only be wrapped, never overwritten. Version-
 * independent — doesn't need `extensionPath`, since matching is done via the
 * stable {@link STATUSLINE_WRAP_PATH_SUFFIX} rather than a full absolute path.
 */
export async function detectStatusLine(): Promise<StatusLineDetection> {
  const current = await readCurrentStatusLine(defaultClaudeSettingsPath());
  if (!current || typeof current.command !== "string" || current.command.trim().length === 0) {
    return { kind: "empty" };
  }
  const withCommand = current as StatusLineConfigWithCommand;
  if (isOurStatuslineWrapCommand(withCommand.command)) {
    return { kind: "already-wrapped", current: withCommand };
  }
  return { kind: "foreign", current: withCommand };
}

/**
 * Pure, read-only render of what "Wrap StatusLine" (or, for the empty case,
 * direct install) would change — the before/after pair the "Preview
 * StatusLine Wrap" command shows side-by-side before anything is written.
 * For `already-wrapped`, shows the up-to-date command against the current
 * one — identical unless the current entry was built against a stale (since
 * auto-updated-away) `extensionPath`, in which case this previews the
 * in-place path refresh `wrapStatusLine` would perform.
 */
export async function previewStatusLineWrap(extensionPath: string): Promise<StatusLinePreview> {
  const detection = await detectStatusLine();
  if (detection.kind === "empty") {
    return {
      detection,
      before: undefined,
      after: { type: "command", command: buildStatusLineDirectCommand(extensionPath), padding: 0 },
    };
  }
  if (detection.kind === "already-wrapped") {
    const refreshedCommand = refreshBundledCommandPaths(
      detection.current.command,
      bundledRunnerPath(extensionPath),
      bundledStatuslineWrapPath(extensionPath)
    );
    return {
      detection,
      before: detection.current,
      after: { ...detection.current, command: refreshedCommand },
    };
  }
  return {
    detection,
    before: detection.current,
    after: {
      ...detection.current,
      type: detection.current.type ?? "command",
      command: buildStatusLineWrapCommand(extensionPath, detection.current.command),
    },
  };
}

/**
 * Installs ClaudeVisual's own statusline command directly — only valid when
 * `statusLine` is currently empty/absent. Records `{existed: false}` in
 * `globalState` so "Restore Original StatusLine" knows to delete the key
 * entirely rather than write back an empty object.
 */
export async function installStatusLineDirect(
  extensionPath: string,
  globalState: GlobalStateLike
): Promise<StatusLineInstallResult> {
  const settingsPath = defaultClaudeSettingsPath();
  const detection = await detectStatusLine();
  if (detection.kind !== "empty") {
    throw new Error("statusLine is already set — use Wrap StatusLine instead of direct install");
  }

  let installed = false;
  const result = await mergeJsonFile(settingsPath, (data) => {
    if (data["statusLine"] !== undefined) {
      return; // race: something set statusLine between detect() and here — bail out without clobbering it
    }
    data["statusLine"] = { type: "command", command: buildStatusLineDirectCommand(extensionPath), padding: 0 };
    installed = true;
  });

  if (installed) {
    const stored: StoredOriginalStatusLine = { existed: false, value: undefined };
    await globalState.update(ORIGINAL_STATUSLINE_STATE_KEY, stored);
  }
  return { settingsPath, backupPath: result.backupPath, installed, keyPath: "statusLine", contentHash: result.contentHash };
}

/**
 * Wraps the existing `statusLine.command` — never overwrites it. Captures the
 * exact pre-wrap `statusLine` object into `globalState` (not `settings.json`)
 * before mutating, so "Restore Original StatusLine" can put it back
 * byte-for-byte regardless of any later settings.json edits. Idempotent: a
 * `statusLine` already pointing at our wrap script with today's
 * `extensionPath` is left untouched. If it instead points at our wrap script
 * built against a *stale* `extensionPath` (a prior VS Code version, now
 * deleted by auto-update — recognized via {@link STATUSLINE_WRAP_PATH_SUFFIX}
 * independent of that old path), the command is refreshed in place rather
 * than left broken or wrapped a second time.
 */
export async function wrapStatusLine(
  extensionPath: string,
  globalState: GlobalStateLike
): Promise<StatusLineWrapResult> {
  const settingsPath = defaultClaudeSettingsPath();
  const detection = await detectStatusLine();
  if (detection.kind === "empty") {
    throw new Error("no existing statusLine to wrap — use direct install instead");
  }
  if (detection.kind === "already-wrapped") {
    const freshCommand = refreshBundledCommandPaths(
      detection.current.command,
      bundledRunnerPath(extensionPath),
      bundledStatuslineWrapPath(extensionPath)
    );
    if (freshCommand === detection.current.command) {
      // Already wrapped with today's extensionPath — genuine no-op, nothing to write.
      return {
        settingsPath,
        backupPath: undefined,
        wrapped: false,
        alreadyWrapped: true,
        keyPath: "statusLine",
        contentHash: undefined,
      };
    }
    // Stale extensionPath from a prior VS Code version — repair in place.
    const refreshResult = await mergeJsonFile(settingsPath, (data) => {
      const existing = data["statusLine"];
      if (typeof existing !== "object" || existing === null || Array.isArray(existing)) {
        throw new JsonMergeError("statusLine is no longer a plain object — refusing to refresh");
      }
      (existing as StatusLineConfig).command = refreshBundledCommandPaths(
        (existing as StatusLineConfig).command ?? "",
        bundledRunnerPath(extensionPath),
        bundledStatuslineWrapPath(extensionPath)
      );
    });
    return {
      settingsPath,
      backupPath: refreshResult.backupPath,
      wrapped: false,
      alreadyWrapped: true,
      keyPath: "statusLine",
      contentHash: refreshResult.contentHash,
    };
  }

  let capturedOriginal: StatusLineConfig | undefined;
  const result = await mergeJsonFile(settingsPath, (data) => {
    const existing = data["statusLine"];
    if (typeof existing !== "object" || existing === null || Array.isArray(existing)) {
      throw new JsonMergeError("statusLine is no longer a plain object — refusing to wrap");
    }
    const existingObj = existing as StatusLineConfig;
    if (isOurStatuslineWrapCommand(existingObj.command)) {
      return; // race: already wrapped between detect() and here — no-op
    }
    capturedOriginal = { ...existingObj };
    data["statusLine"] = {
      ...existingObj,
      type: existingObj.type ?? "command",
      command: buildStatusLineWrapCommand(extensionPath, existingObj.command ?? ""),
    };
  });

  if (capturedOriginal) {
    const stored: StoredOriginalStatusLine = { existed: true, value: capturedOriginal };
    await globalState.update(ORIGINAL_STATUSLINE_STATE_KEY, stored);
  }
  return {
    settingsPath,
    backupPath: result.backupPath,
    wrapped: capturedOriginal !== undefined,
    alreadyWrapped: capturedOriginal === undefined,
    keyPath: "statusLine",
    contentHash: result.contentHash,
  };
}

/**
 * Restores `statusLine` to exactly what it was before "Wrap StatusLine" or
 * "Install StatusLine" ran, sourced from `globalState` — not by parsing
 * whatever `settings.json` currently contains. Deletes the `statusLine` key
 * entirely if it was absent at install time; otherwise writes back the
 * captured original object unchanged. Clears the stored state afterward so a
 * second restore call is a no-op rather than re-applying a stale value.
 */
export async function restoreOriginalStatusLine(globalState: GlobalStateLike): Promise<StatusLineRestoreResult> {
  const settingsPath = defaultClaudeSettingsPath();
  const stored = globalState.get<StoredOriginalStatusLine>(ORIGINAL_STATUSLINE_STATE_KEY);
  if (!stored) {
    return { settingsPath, backupPath: undefined, restored: false, keyPath: "statusLine", contentHash: undefined };
  }

  const result = await mergeJsonFile(settingsPath, (data) => {
    if (stored.existed) {
      data["statusLine"] = stored.value;
    } else {
      delete data["statusLine"];
    }
  });

  await globalState.update(ORIGINAL_STATUSLINE_STATE_KEY, undefined);
  return {
    settingsPath,
    backupPath: result.backupPath,
    restored: true,
    keyPath: "statusLine",
    contentHash: result.contentHash,
  };
}
