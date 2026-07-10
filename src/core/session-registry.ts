import * as fs from "fs";
import * as path from "path";
import { logError } from "../diagnostics/logger";
import { claudeSessionsRoot, normalizeCwd } from "./project-hash";

interface SessionRegistryEntry {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt?: number;
  kind?: string;
  entrypoint?: string;
}

/**
 * Reads the live per-process session registry (`~/.claude/sessions/<pid>.json`)
 * and returns the sessionIds whose `cwd` matches one of the given workspace
 * folders. Used only to flag a session as live/idle — never surfaces
 * sessions from unrelated projects.
 */
export async function listLiveSessionIds(workspaceCwds: readonly string[]): Promise<Set<string>> {
  const dir = claudeSessionsRoot();
  const live = new Set<string>();
  const normalizedWorkspaceCwds = new Set(workspaceCwds.map(normalizeCwd));

  const entries = await fs.promises.readdir(dir).catch(() => [] as string[]);
  for (const entry of entries) {
    if (!entry.endsWith(".json")) {
      continue;
    }
    const filePath = path.join(dir, entry);
    try {
      const content = await fs.promises.readFile(filePath, "utf8");
      const parsed = JSON.parse(content) as SessionRegistryEntry;
      if (parsed.cwd && normalizedWorkspaceCwds.has(normalizeCwd(parsed.cwd))) {
        live.add(parsed.sessionId);
      }
    } catch (err) {
      logError(`session-registry: failed reading ${filePath}`, err);
    }
  }
  return live;
}
