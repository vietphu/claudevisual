// Host <-> webview message contracts. Deliberately free of any `vscode` or
// `core/*` runtime import: this file is reached by BOTH esbuild entry points
// (extension host via panel.ts/config-form.ts, and the browser-context
// webview-ui bundle via main.ts). Every cross-boundary type it re-exports
// (SettingsFieldDef, SettingsScope, ChartPoint) is imported with `import
// type`, which TypeScript erases entirely — so esbuild's browser bundle
// never needs to resolve "vscode" at runtime.
import type { SettingsScope } from "../../config/settings-paths";
import type { SettingsFieldDef } from "../../config/settings-schema";
import type { ChartPoint } from "./charts";

/** One config-form field as rendered by the webview: its static schema plus
 *  the effective current value/scope (or, for action-toggle fields, whether
 *  the delegated installer action is currently "on"). */
export interface FieldViewModel {
  field: SettingsFieldDef;
  effectiveValue: unknown;
  effectiveScope: SettingsScope | undefined;
  /** Only meaningful for `field.kind === "action-toggle"`. */
  toggleOn?: boolean;
}

export interface InitMessage {
  type: "init";
  fields: FieldViewModel[];
  hasProjectScope: boolean;
}

export interface MetricsDiffMessage {
  type: "metrics-diff";
  points: ChartPoint[];
}

/** One advisor recommendation in the dashboard report (self-contained mirror of the
 *  core `Recommendation`, so this browser-reachable file stays core-import-free). */
export interface AdvisorReportRecommendation {
  id: string;
  severity: "critical" | "warn" | "info";
  category: "cost" | "context" | "cache" | "model" | "orchestration";
  title: string;
  detail?: string;
  metric?: string;
}

export interface AdvisorReportDimension {
  key: string;
  label: string;
  score: number;
}

/** The retrospective Efficiency report for the primary (most-recently-updated)
 *  session, pushed on every store change. */
export interface AdvisorReport {
  sessionId: string;
  sessionLabel: string;
  model?: string;
  score: number;
  grade: string;
  neutral: boolean;
  dimensions: AdvisorReportDimension[];
  recommendations: AdvisorReportRecommendation[];
  costDisplay?: string;
  costTooltip?: string;
}

export interface AdvisorReportMessage {
  type: "advisor-report";
  /** null when there's no session to report on yet. */
  report: AdvisorReport | null;
}

export interface WriteResultMessage {
  type: "write-result";
  fieldId: string;
  ok: boolean;
  error?: string;
  before?: unknown;
  after?: unknown;
  scope?: SettingsScope;
}

export interface UndoResultMessage {
  type: "undo-result";
  fieldId: string;
  ok: boolean;
  error?: string;
}

export type HostToWebviewMessage =
  | InitMessage
  | MetricsDiffMessage
  | AdvisorReportMessage
  | WriteResultMessage
  | UndoResultMessage;

export interface ReadyMessage {
  type: "ready";
}

export interface WriteFieldMessage {
  type: "write-field";
  fieldId: string;
  scope: SettingsScope;
  value: unknown;
}

export interface ToggleMessage {
  type: "toggle";
  fieldId: string;
  enable: boolean;
}

export interface UndoMessage {
  type: "undo";
  fieldId: string;
}

export type WebviewToHostMessage = ReadyMessage | WriteFieldMessage | ToggleMessage | UndoMessage;
