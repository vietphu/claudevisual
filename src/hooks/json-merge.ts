import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

/**
 * Thrown for every failure mode of {@link mergeJsonFile}: malformed JSON on
 * disk, a `mutate` callback that throws, an `ensureArray`/`ensureObject`
 * shape mismatch, or a failed write. Callers can catch this specifically to
 * distinguish "the merge itself failed" from unrelated errors.
 */
export class JsonMergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonMergeError";
  }
}

export interface MergeResult {
  /** Path to the timestamped backup copy, or `undefined` if `filePath` didn't exist yet (nothing to back up). */
  backupPath: string | undefined;
  /** SHA-256 hex digest of the exact bytes this call wrote to `filePath` — a
   *  write-time fingerprint `config-writer.ts`'s Undo logic compares against
   *  the file's current bytes to detect whether a later write has landed on
   *  top before it acts. */
  contentHash: string;
}

/** Serializes {@link mergeJsonFile} calls per absolute file path so concurrent
 *  callers targeting the same file (e.g. the webview's Save button and a
 *  hooks/statusline install firing within the same event-loop tick) queue
 *  instead of racing: each read -> backup -> mutate -> write cycle only
 *  starts once the prior one on that path has fully settled. Mirrors the
 *  `inFlight`-promise-chain idiom in `../core/jsonl-tailer.ts` /
 *  `../core/event-log-reader.ts`, adapted from "serialize reads, log write
 *  errors" to "serialize writes, propagate errors to the caller waiting on
 *  them" — an Undo/toggle click needs to know its own write failed, not have
 *  it silently swallowed like a background tail read would be. */
const writeLocks = new Map<string, Promise<unknown>>();

/**
 * The single safe read-modify-write path for every JSON config file this
 * extension mutates (hooks installer today; statusline wrap + config-writer
 * in later phases reuse this unchanged). Flow: read -> parse -> timestamped
 * backup -> mutate in memory -> atomic write-then-rename -> rollback to the
 * backup on any write failure. Never partially overwrites the target file.
 * Concurrent calls against the same `filePath` are queued (see `writeLocks`)
 * rather than run in parallel, so two overlapping callers can never both read
 * the same pre-mutation snapshot and have one silently clobber the other's
 * write.
 *
 * `mutate` receives the parsed JSON (or `{}` if the file doesn't exist yet)
 * and mutates it in place. Throwing from `mutate` aborts before anything is
 * written to disk.
 */
export async function mergeJsonFile<T extends Record<string, unknown> = Record<string, unknown>>(
  filePath: string,
  mutate: (data: T) => void
): Promise<MergeResult> {
  const prior = writeLocks.get(filePath) ?? Promise.resolve();
  const run = prior.then(
    () => mergeJsonFileUnlocked<T>(filePath, mutate),
    () => mergeJsonFileUnlocked<T>(filePath, mutate)
  );
  // Never-rejecting derivative so the *next* queued caller always proceeds
  // once this one settles — this call's own success/failure is what `run`
  // (returned below) carries back to its own caller instead.
  const settled = run.then(
    () => undefined,
    () => undefined
  );
  writeLocks.set(filePath, settled);
  try {
    return await run;
  } finally {
    // Drop the entry once nothing is queued behind this call, so the map
    // doesn't grow unbounded across a long-running VS Code session. Compares
    // by reference: if a later caller already queued behind us, it replaced
    // the map entry with its own `settled` promise, so this check no-ops and
    // leaves that entry alone.
    if (writeLocks.get(filePath) === settled) {
      writeLocks.delete(filePath);
    }
  }
}

async function mergeJsonFileUnlocked<T extends Record<string, unknown>>(
  filePath: string,
  mutate: (data: T) => void
): Promise<MergeResult> {
  const data = await readJsonFileOrEmpty<T>(filePath);
  const backupPath = await backupIfExists(filePath);

  try {
    mutate(data);
  } catch (err) {
    throw new JsonMergeError(
      `mutate callback threw for ${filePath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const contentHash = await atomicWrite(filePath, data, backupPath);
  return { backupPath, contentHash };
}

/**
 * Returns the array stored at `container[key]`, creating an empty one if the
 * key is absent. Throws {@link JsonMergeError} if the key exists but holds a
 * non-array value — the defensive "assert target is an array before
 * appending" gate every hooks.<Event> mutation must pass.
 */
export function ensureArray(container: Record<string, unknown>, key: string): unknown[] {
  const existing = container[key];
  if (existing === undefined) {
    const created: unknown[] = [];
    container[key] = created;
    return created;
  }
  if (!Array.isArray(existing)) {
    throw new JsonMergeError(`expected "${key}" to be an array, got ${typeof existing}`);
  }
  return existing;
}

/**
 * Returns the plain object stored at `container[key]`, creating an empty one
 * if the key is absent. Throws {@link JsonMergeError} if the key exists but
 * holds a non-object (or array) value.
 */
export function ensureObject(container: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = container[key];
  if (existing === undefined) {
    const created: Record<string, unknown> = {};
    container[key] = created;
    return created;
  }
  if (typeof existing !== "object" || existing === null || Array.isArray(existing)) {
    throw new JsonMergeError(`expected "${key}" to be an object, got ${typeof existing}`);
  }
  return existing as Record<string, unknown>;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFileOrEmpty<T>(filePath: string): Promise<T> {
  if (!(await fileExists(filePath))) {
    return {} as T;
  }
  const content = await fs.promises.readFile(filePath, "utf8");
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return {} as T;
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch (err) {
    throw new JsonMergeError(
      `failed to parse JSON at ${filePath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function backupIfExists(filePath: string): Promise<string | undefined> {
  if (!(await fileExists(filePath))) {
    return undefined;
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${filePath}.bak-${timestamp}`;
  await fs.promises.copyFile(filePath, backupPath);
  return backupPath;
}

/** SHA-256 hex digest of a string, in the exact encoding `atomicWrite` writes
 *  to disk — the shared primitive behind {@link MergeResult.contentHash} and
 *  `readFileHash` below, so a write-time fingerprint and an Undo-time
 *  re-read are always computed the same way. */
export function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Re-reads `filePath`'s current raw bytes and hashes them with
 * {@link hashContent} — `undefined` if the file is missing/unreadable.
 * `config-writer.ts`'s Undo path uses this to detect whether a later write
 * has landed on top of the one it's about to revert, by comparing against
 * the `contentHash` captured at that earlier write's own completion.
 */
export async function readFileHash(filePath: string): Promise<string | undefined> {
  try {
    const content = await fs.promises.readFile(filePath, "utf8");
    return hashContent(content);
  } catch {
    return undefined;
  }
}

/**
 * Writes to a temp file in the same directory (so the rename is on the same
 * filesystem, keeping it atomic on POSIX) then renames over the target.
 * On any failure — including the rename itself — best-effort restores the
 * pre-mutation backup so the target file is never left half-written.
 * Returns the SHA-256 fingerprint of the exact bytes written, matching what
 * `readFileHash` would compute from re-reading `filePath` immediately after.
 */
async function atomicWrite(filePath: string, data: unknown, backupPath: string | undefined): Promise<string> {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
  const content = `${JSON.stringify(data, null, 2)}\n`;

  try {
    await fs.promises.writeFile(tmpPath, content, "utf8");
    await fs.promises.rename(tmpPath, filePath);
    return hashContent(content);
  } catch (err) {
    await fs.promises.rm(tmpPath, { force: true }).catch(() => undefined);
    if (backupPath) {
      await fs.promises.copyFile(backupPath, filePath).catch(() => undefined);
    }
    throw new JsonMergeError(
      `failed to write ${filePath}, rolled back to backup: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
