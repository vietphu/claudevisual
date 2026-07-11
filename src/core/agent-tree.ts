import { SubAgentState } from "./types";

/** One node in the reconstructed agent tree: an agent plus its nested children
 *  and its depth from the root (0 = spawned directly by the main session). */
export interface AgentTreeNode {
  agent: SubAgentState;
  children: AgentTreeNode[];
  depth: number;
}

/**
 * Reconstructs the parent→child agent tree from the flat `subagents` map,
 * grouping by each agent's own `parentAgentId` (sourced from its
 * `agent-<agentId>.meta.json` sidecar — see `applySubagentMetaOverlay` in
 * `session-state-overlays.ts`). An agent is a **root** when it has no
 * `parentAgentId`, or that parent isn't (yet) a known agent — i.e. spawned by
 * the main session, or its meta sidecar hasn't been read yet. Pure and
 * order-independent, so a child whose sidecar arrives before its parent's own
 * entry exists self-heals on the next render: it renders at the root until
 * the link resolves, then nests.
 */
export function buildAgentTree(subagents: ReadonlyMap<string, SubAgentState>): AgentTreeNode[] {
  const childrenOf = new Map<string, SubAgentState[]>();
  const roots: SubAgentState[] = [];
  for (const agent of subagents.values()) {
    if (agent.parentAgentId && subagents.has(agent.parentAgentId)) {
      const siblings = childrenOf.get(agent.parentAgentId) ?? [];
      siblings.push(agent);
      childrenOf.set(agent.parentAgentId, siblings);
    } else {
      roots.push(agent);
    }
  }

  // `visited` guards against a pathological cycle (a's parent is b, b's parent
  // is a) so recursion terminates.
  const visited = new Set<string>();
  const build = (agent: SubAgentState, depth: number): AgentTreeNode => {
    visited.add(agent.agentId);
    const children = (childrenOf.get(agent.agentId) ?? [])
      .filter((child) => !visited.has(child.agentId))
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((child) => build(child, depth + 1));
    return { agent, children, depth };
  };

  const byStart = (a: SubAgentState, b: SubAgentState) => a.startedAt - b.startedAt;
  const nodes = roots.sort(byStart).map((root) => build(root, 0));

  // Fail-open: surface any agent not reached from a root (only possible under a
  // pathological mutual-parent cycle with no entry point) at the root rather
  // than silently dropping it — the tree must account for every observed agent.
  for (const agent of Array.from(subagents.values()).sort(byStart)) {
    if (!visited.has(agent.agentId)) {
      nodes.push(build(agent, 0));
    }
  }
  return nodes;
}

/** Pre-order (parent-before-children) flattening of the tree — the render order
 *  for the flat, depth-indented agent list. */
export function flattenAgentTree(nodes: readonly AgentTreeNode[]): AgentTreeNode[] {
  const out: AgentTreeNode[] = [];
  const walk = (node: AgentTreeNode) => {
    out.push(node);
    node.children.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}
