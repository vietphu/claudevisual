import * as fs from "fs";
import { mergeJsonFile, readFileHash } from "../hooks/json-merge";
import { getByPath, resolveSettingsPaths, setByPath, settingsPathForScope, SettingsScope } from "./settings-paths";

export interface ConfigWriteResult {
  fieldId: string;
  scope: SettingsScope;
  settingsPath: string;
  keyPath: string;
  previousValue: unknown;
  newValue: unknown;
  /** Path to the pre-write backup json-merge.ts created, or `undefined` if
   *  the target file didn't exist before this write — the single source of
   *  truth {@link restoreFromBackup} uses for Undo. */
  backupPath: string | undefined;
  /** SHA-256 fingerprint of the file's bytes immediately after this write —
   *  `mergeJsonFile`'s `contentHash`. {@link restoreFromBackup} compares this
   *  against the file's current bytes to detect whether a later write has
   *  landed on top before it acts, for the `backupPath === undefined` case. */
  contentHash: string;
}

/**
 * Everything {@link restoreFromBackup} needs to safely revert exactly one
 * write — assembled by `config-form.ts` from whichever write result
 * (`writeSettingsField`, or a hooks/statusline installer call) it's tracking
 * as the "last write" for a given field. `keyPath` is the top-level (or
 * dotted) settings.json key that write touched; `contentHash` is the write's
 * own post-write fingerprint.
 */
export interface WriteUndoInfo {
  settingsPath: string;
  backupPath: string | undefined;
  keyPath: string;
  contentHash: string;
}

/**
 * THE single write path for every settings.json field the dashboard's config
 * form edits — built directly on `../hooks/json-merge.ts`'s backup + atomic
 * write-then-rollback path (Phase 3), the same guarantees the hooks/statusline
 * installers rely on, generalized to arbitrary dot-path keys instead of the
 * installers' fixed `hooks`/`statusLine` shapes.
 */
export async function writeSettingsField(
  fieldId: string,
  keyPath: string,
  scope: SettingsScope,
  value: unknown,
  workspaceRoot: string | undefined
): Promise<ConfigWriteResult> {
  const paths = resolveSettingsPaths(workspaceRoot);
  const settingsPath = settingsPathForScope(paths, scope);

  let previousValue: unknown;
  const result = await mergeJsonFile(settingsPath, (data) => {
    previousValue = getByPath(data, keyPath);
    setByPath(data, keyPath, value);
  });

  return {
    fieldId,
    scope,
    settingsPath,
    keyPath,
    previousValue,
    newValue: value,
    backupPath: result.backupPath,
    contentHash: result.contentHash,
  };
}

/**
 * Reverts one write performed by {@link writeSettingsField} — or a toggle
 * delegated to the hooks/statusline installer (Phase 3/4), which returns the
 * same `{settingsPath, backupPath, keyPath, contentHash}` shape — by
 * restoring the exact pre-write bytes from the timestamped backup
 * `json-merge.ts` created.
 *
 * When `backupPath` is set (the file already existed before the write being
 * undone), the backup is the single source of truth: copy it back verbatim,
 * matching json-merge.ts's own rollback behavior on write failure.
 *
 * When `backupPath` is `undefined`, nothing existed at `settingsPath` before
 * that write — so undoing it must NOT delete the whole file (a later,
 * unrelated write may have landed on top of it since). Instead this removes
 * only the top-level key that write added, via the now-locked
 * `mergeJsonFile`. Before touching anything, it compares the file's current
 * bytes against `contentHash` (the fingerprint captured right after the
 * original write completed); if they differ, some other write has happened
 * since and this refuses rather than guessing which parts of the file are
 * still "ours" to remove.
 */
export async function restoreFromBackup(info: WriteUndoInfo): Promise<void> {
  const { settingsPath, backupPath, keyPath, contentHash } = info;
  if (backupPath) {
    await fs.promises.copyFile(backupPath, settingsPath);
    return;
  }

  const currentHash = await readFileHash(settingsPath);
  if (currentHash !== contentHash) {
    throw new Error(
      "cannot undo: settings.json has changed since this write — refusing to guess which parts are still " +
        "safe to remove. Please edit ~/.claude/settings.json manually if needed."
    );
  }

  const topLevelKey = keyPath.split(".")[0];
  await mergeJsonFile(settingsPath, (data) => {
    delete data[topLevelKey];
  });
}
