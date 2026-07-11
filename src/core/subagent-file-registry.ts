import * as path from "path";
import * as vscode from "vscode";
import { readSubagentMeta, SubagentMeta } from "./subagent-meta-reader";

/** Fired once a sub-agent's `agent-<agentId>.meta.json` sidecar has been
 *  successfully read — see {@link readSubagentMeta}. */
export interface SubagentMetaEvent {
  sessionId: string;
  agentId: string;
  meta: SubagentMeta;
}

const AGENT_FILE_NAME_RE = /^agent-(.+)\.jsonl$/;

/**
 * Tracks which sub-agent transcript file belongs to which `(sessionId, agentId)`,
 * and emits each sub-agent's `.meta.json` sidecar the first time it becomes
 * readable. Split out of `JsonlTailer` purely to keep that file under the
 * repo's per-file line budget — it has no tailing/watching logic of its own.
 */
export class SubagentFileRegistry implements vscode.Disposable {
  private readonly fileMeta = new Map<string, { sessionId: string; agentId: string }>();
  /** filePath of every transcript whose `.meta.json` has already been read —
   *  guards against re-emitting on every subsequent line-append. */
  private readonly metaEmittedFor = new Set<string>();
  private readonly metaEmitter = new vscode.EventEmitter<SubagentMetaEvent>();

  readonly onSubagentMeta = this.metaEmitter.event;

  /** Registers `filePath` as a sub-agent transcript for `sessionId`, deriving its
   *  agentId from the filename. No-op if the name doesn't match the expected shape. */
  register(filePath: string, sessionId: string): void {
    const match = AGENT_FILE_NAME_RE.exec(path.basename(filePath));
    if (!match) {
      return;
    }
    this.fileMeta.set(filePath, { sessionId, agentId: match[1] });
  }

  lookup(filePath: string): { sessionId: string; agentId: string } | undefined {
    return this.fileMeta.get(filePath);
  }

  /**
   * Reads `filePath`'s sibling `.meta.json` and fires `onSubagentMeta` the
   * first time it parses successfully. Safe to call on every prime/watcher
   * touch of the `.jsonl` file (not just its creation) so a sidecar written
   * slightly after the transcript file itself is still picked up on the next
   * append rather than being missed permanently.
   */
  maybeEmitMeta(filePath: string): void {
    if (this.metaEmittedFor.has(filePath)) {
      return;
    }
    const fileMeta = this.fileMeta.get(filePath);
    if (!fileMeta) {
      return;
    }
    const meta = readSubagentMeta(path.dirname(filePath), fileMeta.agentId);
    if (!meta) {
      return;
    }
    this.metaEmittedFor.add(filePath);
    this.metaEmitter.fire({ sessionId: fileMeta.sessionId, agentId: fileMeta.agentId, meta });
  }

  dispose(): void {
    this.metaEmitter.dispose();
  }
}
