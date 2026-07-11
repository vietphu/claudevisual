import * as vscode from "vscode";
import { AdvisorConfig, BillingPlan } from "../core/advisor/advisor-config";

/**
 * Resolves the Efficiency Advisor's billing-plan config from the
 * `claudevisual.advisor.plan` setting. Kept in the config layer (not core, which
 * stays vscode-free) so both webviews and the status bar share one source. Falls
 * back to "max" — the common Claude Code subscription case — for any unset or
 * unexpected value.
 */
export function resolveAdvisorConfig(): AdvisorConfig {
  const raw = vscode.workspace.getConfiguration("claudevisual").get<string>("advisor.plan");
  const plan: BillingPlan = raw === "pro" || raw === "api" || raw === "max" ? raw : "max";
  return { plan };
}
