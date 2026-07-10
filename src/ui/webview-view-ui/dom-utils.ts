/** Escapes a string for safe interpolation into innerHTML — tool details and
 *  file paths are untrusted (they come from the user's own transcripts, but
 *  may contain `<`, `&`, quotes that would otherwise break the markup). */
export function esc(value: string | undefined): string {
  if (!value) {
    return "";
  }
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Compact token count for display: `29.6M`, `84.0k`, `512`. Mirrors the
 *  host-side `formatTokenCount` (kept here so the browser bundle needs no
 *  core import at runtime). */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}k`;
  }
  return `${n}`;
}

/** Model family for the tier-colored chip: opus | sonnet | haiku | fable | other. */
export function modelTier(model: string | undefined): string {
  if (!model) {
    return "other";
  }
  for (const tier of ["opus", "sonnet", "haiku", "fable"]) {
    if (model.includes(tier)) {
      return tier;
    }
  }
  return "other";
}

/** Strips the `claude-` prefix and trailing date suffix for a compact chip label. */
export function shortModel(model: string): string {
  return model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

/** `<span class="mp …">` model chip markup, or "" when the model is unknown. */
export function modelChip(model: string | undefined): string {
  if (!model) {
    return "";
  }
  return `<span class="mp ${modelTier(model)}" title="${esc(model)}">${esc(shortModel(model))}</span>`;
}
