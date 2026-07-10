import * as vscode from "vscode";
import { SessionStateStore } from "../../core/session-state-store";
import { SessionState } from "../../core/types";
import { CategoryNode, SessionNode, SkillNode, SubAgentNode, ToolCallNode, TreeNode } from "./tree-nodes";

/**
 * Sidebar TreeView: `Session > {Sub-agents, Skills invoked, Recent tool calls}`.
 * Root nodes are keyed strictly by `sessionId` (via `SessionNode.id`), so two
 * concurrent sessions sharing the same `cwd` always render as separate
 * sibling roots — never merged/conflated by cwd.
 */
export class SessionTreeProvider implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<TreeNode | undefined | void>();
  private readonly storeSubscription: vscode.Disposable;
  private sessions: SessionState[] = [];

  readonly onDidChangeTreeData = this.emitter.event;

  constructor(store: SessionStateStore) {
    this.sessions = store.snapshot();
    this.storeSubscription = store.onDidChange((sessions) => this.refresh(sessions));
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      return this.sessions
        .slice()
        .sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt)
        .map((session) => new SessionNode(session));
    }
    if (element instanceof SessionNode) {
      return this.buildCategoryNodes(element.session);
    }
    if (element instanceof CategoryNode) {
      return this.buildCategoryChildren(element);
    }
    return [];
  }

  dispose(): void {
    this.storeSubscription.dispose();
    this.emitter.dispose();
  }

  /** Re-pulls the latest snapshot and re-renders the whole tree. Called on
   * every store change; the store itself already debounces bursts of JSONL
   * appends into a single notification. */
  private refresh(sessions: SessionState[]): void {
    this.sessions = sessions;
    this.emitter.fire();
  }

  private buildCategoryNodes(session: SessionState): CategoryNode[] {
    return [
      new CategoryNode("subagents", session.sessionId, "Sub-agents", session.subagents.size),
      new CategoryNode("skills", session.sessionId, "Skills invoked", session.skillsInvoked.length),
      new CategoryNode("toolcalls", session.sessionId, "Recent tool calls", session.recentToolCalls.length),
    ];
  }

  private buildCategoryChildren(category: CategoryNode): TreeNode[] {
    const session = this.sessions.find((s) => s.sessionId === category.sessionId);
    if (!session) {
      return [];
    }
    switch (category.categoryKind) {
      case "subagents":
        return Array.from(session.subagents.values())
          .sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt)
          .map((subagent) => new SubAgentNode(session.sessionId, subagent));
      case "skills":
        return session.skillsInvoked.map((skill, index) => new SkillNode(session.sessionId, skill, index));
      case "toolcalls":
        return session.recentToolCalls
          .slice()
          .reverse()
          .map((call, index) => new ToolCallNode(session.sessionId, call, index));
      default:
        return [];
    }
  }
}
