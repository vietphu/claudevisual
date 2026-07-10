import type { FileViewModel, SessionViewModel } from "../webview-view/sidebar-messages";
import { esc } from "./dom-utils";

/** Files-touched panel, grouped by directory. Each row shows the basename and
 *  an edit/read access tag. */
export function renderFiles(s: SessionViewModel): string {
  if (s.files.length === 0) {
    return "";
  }
  const groups = groupByDir(s.files);
  const body = Object.keys(groups)
    .map((dir) => renderGroup(dir, groups[dir]))
    .join("");

  return `
  <div class="section">
    <div class="lbl">Files touched <span class="line"></span><span class="count">${s.files.length}</span></div>
    <div class="files">${body}</div>
  </div>`;
}

function renderGroup(dir: string, files: FileViewModel[]): string {
  const header = dir ? `<div class="fgroup">${esc(dir)}/</div>` : "";
  return header + files.map(renderFileRow).join("");
}

function renderFileRow(f: FileViewModel): string {
  return `
  <div class="file" title="${esc(f.path)}">
    <span class="fi ${f.access}"></span>
    <span class="nm">${esc(f.base)}</span>
    <span class="tag ${f.access}">${f.access}</span>
  </div>`;
}

function groupByDir(files: FileViewModel[]): Record<string, FileViewModel[]> {
  const groups: Record<string, FileViewModel[]> = {};
  for (const f of files) {
    (groups[f.dir] ??= []).push(f);
  }
  return groups;
}
