/**
 * Deterministic agent-identity color assignment. Returns a palette index
 * (0..PALETTE_SIZE-1) the sidebar CSS maps to a concrete color via `--a{index}`
 * custom properties. The mapping is stable across reloads (pure hash of the
 * agentId) so an agent keeps its color everywhere it appears — tree, heartbeat,
 * feed, files — which is the whole point of a shared identity system.
 *
 * Deliberately vscode-free and side-effect-free so it is unit-testable and
 * reusable by every sidebar section.
 */

import { MAIN_AGENT_ID } from "../../core/types";

/** Re-exported so color consumers get the sentinel from one import. */
export { MAIN_AGENT_ID };

/** Number of identity colors defined in `sidebar.css` as `--a0`..`--a6`. */
export const PALETTE_SIZE = 7;

/** The orchestrator/root session always takes index 0 (the accent color). */
export const MAIN_COLOR_INDEX = 0;

/**
 * Maps an agentId to a palette index in `[1, PALETTE_SIZE)` (index 0 is
 * reserved for `main`). Uses a small FNV-1a hash so the distribution is stable
 * and spread across the non-root palette slots.
 */
export function agentColorIndex(agentId: string): number {
  if (agentId === MAIN_AGENT_ID) {
    return MAIN_COLOR_INDEX;
  }
  let hash = 0x811c9dc5;
  for (let i = 0; i < agentId.length; i++) {
    hash ^= agentId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const nonRootSlots = PALETTE_SIZE - 1;
  return 1 + (Math.abs(hash) % nonRootSlots);
}
