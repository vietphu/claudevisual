/**
 * Editable field schema for the dashboard's config-editing form. Field names
 * (`model`, `effortLevel`, `permissions.defaultMode`) and enum values are
 * taken from Claude Code's published settings.json schema
 * (schemastore.org/claude-code-settings.json, fetched 2026-07-10) — not
 * invented locally, so the form writes keys Claude Code actually reads.
 */

export type SettingsFieldKind = "text" | "select" | "action-toggle";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SettingsFieldDef {
  id: string;
  label: string;
  description: string;
  kind: SettingsFieldKind;
  /** Dot-path into settings.json. Present for `"text"`/`"select"` kinds
   *  only — `"action-toggle"` fields (hooks/statusline) are compound
   *  installer actions with no single scalar key, see config-form.ts. */
  keyPath?: string;
  options?: SelectOption[];
  placeholder?: string;
}

export const MODEL_FIELD: SettingsFieldDef = {
  id: "model",
  label: "Default Model",
  description: "Overrides the default model Claude Code launches with (`model` in settings.json).",
  kind: "text",
  keyPath: "model",
  placeholder: "e.g. claude-sonnet-5",
};

export const EFFORT_LEVEL_FIELD: SettingsFieldDef = {
  id: "effortLevel",
  label: "Effort Level",
  description: "Reasoning effort Claude Code requests from the model (`effortLevel`).",
  kind: "select",
  keyPath: "effortLevel",
  options: [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "xhigh", label: "X-High" },
  ],
};

export const PERMISSIONS_DEFAULT_MODE_FIELD: SettingsFieldDef = {
  id: "permissionsDefaultMode",
  label: "Permission Mode",
  description: "Default permission mode for new sessions (`permissions.defaultMode`).",
  kind: "select",
  keyPath: "permissions.defaultMode",
  options: [
    { value: "default", label: "Default (ask)" },
    { value: "acceptEdits", label: "Accept Edits" },
    { value: "bypassPermissions", label: "Bypass Permissions" },
    { value: "plan", label: "Plan Mode" },
    { value: "delegate", label: "Delegate" },
    { value: "dontAsk", label: "Don't Ask" },
    { value: "auto", label: "Auto" },
  ],
};

/** Delegates to Phase 3's `installer.ts` `installHooks`/`uninstallHooks` —
 *  always global scope (the installer only ever targets `~/.claude/settings.json`). */
export const HOOKS_TOGGLE_FIELD: SettingsFieldDef = {
  id: "hooksInstalled",
  label: "Install Hooks",
  description:
    "Wires ClaudeVisual's event-log hooks into ~/.claude/settings.json for low-latency status " +
    "(delegates to the hooks installer; global scope only).",
  kind: "action-toggle",
};

/** Delegates to Phase 4's `installer.ts` `wrapStatusLine`/`installStatusLineDirect`/
 *  `restoreOriginalStatusLine` — always global scope. */
export const STATUSLINE_TOGGLE_FIELD: SettingsFieldDef = {
  id: "statusLineWrapped",
  label: "Wrap StatusLine",
  description:
    "Wraps (or installs) the statusLine command for precise context%/cost " +
    "(delegates to the statusline installer; global scope only).",
  kind: "action-toggle",
};

export const SETTINGS_FIELDS: SettingsFieldDef[] = [
  MODEL_FIELD,
  EFFORT_LEVEL_FIELD,
  PERMISSIONS_DEFAULT_MODE_FIELD,
  HOOKS_TOGGLE_FIELD,
  STATUSLINE_TOGGLE_FIELD,
];
