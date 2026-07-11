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

const usdFormatter = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });

/** Locale-aware USD string (thousands separators included) — never hand-roll
 *  `$` + `toFixed(2)`, which silently drops grouping on larger costs. */
export function formatUsd(n: number): string {
  return usdFormatter.format(n);
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

/** Compact elapsed duration: `52s`, `1m10s`, `3m22s`, `1h04m`. */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  if (total < 60) {
    return `${total}s`;
  }
  const m = Math.floor(total / 60);
  if (m < 60) {
    const s = total % 60;
    return s ? `${m}m${s}s` : `${m}m`;
  }
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h${String(rm).padStart(2, "0")}m`;
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
