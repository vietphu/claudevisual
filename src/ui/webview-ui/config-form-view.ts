// Renders the dual-scope config-editing form and the diff/confirm-with-Undo
// toast, entirely with plain DOM APIs (no framework, matching the rest of
// this extension's minimal-dependency style).
import type { FieldViewModel, WriteResultMessage } from "../webview/messages";
import { postToHost } from "./vscode-api";

/** How long a write's confirm toast stays up before being considered final
 *  (i.e. the Undo action disappears with it) — long enough to read and react,
 *  short enough not to clutter the panel across multiple edits. */
const TOAST_TIMEOUT_MS = 8000;

export class ConfigFormView {
  private hasProjectScope = false;

  constructor(private readonly container: HTMLElement, private readonly toastContainer: HTMLElement) {}

  renderInit(fields: FieldViewModel[], hasProjectScope: boolean): void {
    this.hasProjectScope = hasProjectScope;
    this.container.innerHTML = "";
    for (const vm of fields) {
      this.container.appendChild(this.renderField(vm));
    }
  }

  handleWriteResult(message: WriteResultMessage): void {
    if (!message.ok) {
      this.showToast(`Failed to update ${message.fieldId}: ${message.error ?? "unknown error"}`, undefined);
      return;
    }
    const scopeSuffix = message.scope ? ` (${message.scope})` : "";
    const summary = `${message.fieldId}: ${formatValue(message.before)} → ${formatValue(message.after)}${scopeSuffix}`;
    this.showToast(summary, message.fieldId);
  }

  handleUndoResult(fieldId: string, ok: boolean, error: string | undefined): void {
    this.showToast(ok ? `Reverted ${fieldId}.` : `Undo failed for ${fieldId}: ${error ?? "unknown error"}`, undefined);
  }

  private renderField(vm: FieldViewModel): HTMLElement {
    const row = document.createElement("div");
    row.className = "cv-field-row";

    const label = document.createElement("label");
    label.textContent = vm.field.label;
    label.title = vm.field.description;
    row.appendChild(label);

    if (vm.field.kind === "action-toggle") {
      row.appendChild(this.renderToggle(vm));
      return row;
    }

    row.appendChild(this.renderEffectiveValue(vm));
    const input = this.renderInput(vm);
    row.appendChild(input.element);

    const scopeSelect = this.renderScopeSelect(vm);
    row.appendChild(scopeSelect);

    const saveButton = document.createElement("button");
    saveButton.textContent = "Save";
    saveButton.addEventListener("click", () => {
      postToHost({
        type: "write-field",
        fieldId: vm.field.id,
        scope: scopeSelect.value === "project" ? "project" : "global",
        value: input.getValue(),
      });
    });
    row.appendChild(saveButton);

    return row;
  }

  private renderEffectiveValue(vm: FieldViewModel): HTMLElement {
    const effective = document.createElement("span");
    effective.className = "cv-effective-value";
    effective.textContent = vm.effectiveScope
      ? `current: ${formatValue(vm.effectiveValue)} (${vm.effectiveScope})`
      : "current: unset";
    return effective;
  }

  private renderScopeSelect(vm: FieldViewModel): HTMLSelectElement {
    const select = document.createElement("select");
    select.className = "cv-scope-select";
    select.appendChild(new Option("Global", "global"));
    if (this.hasProjectScope) {
      select.appendChild(new Option("Project", "project"));
    }
    select.value = vm.effectiveScope ?? "global";
    return select;
  }

  private renderInput(vm: FieldViewModel): { element: HTMLElement; getValue: () => unknown } {
    if (vm.field.kind === "select" && vm.field.options) {
      const select = document.createElement("select");
      for (const opt of vm.field.options) {
        select.appendChild(new Option(opt.label, opt.value));
      }
      if (typeof vm.effectiveValue === "string") {
        select.value = vm.effectiveValue;
      }
      return { element: select, getValue: () => select.value };
    }
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = vm.field.placeholder ?? "";
    if (typeof vm.effectiveValue === "string") {
      input.value = vm.effectiveValue;
    }
    return { element: input, getValue: () => input.value };
  }

  private renderToggle(vm: FieldViewModel): HTMLElement {
    const wrapper = document.createElement("span");
    wrapper.className = "cv-toggle";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = vm.toggleOn ?? false;
    checkbox.addEventListener("change", () => {
      postToHost({ type: "toggle", fieldId: vm.field.id, enable: checkbox.checked });
    });
    wrapper.appendChild(checkbox);

    const desc = document.createElement("span");
    desc.className = "cv-field-description";
    desc.textContent = vm.field.description;
    wrapper.appendChild(desc);

    return wrapper;
  }

  private showToast(text: string, undoFieldId: string | undefined): void {
    const toast = document.createElement("div");
    toast.className = "cv-toast";

    const msg = document.createElement("span");
    msg.textContent = text;
    toast.appendChild(msg);

    if (undoFieldId) {
      const undoBtn = document.createElement("button");
      undoBtn.textContent = "Undo";
      undoBtn.addEventListener("click", () => {
        postToHost({ type: "undo", fieldId: undoFieldId });
        toast.remove();
      });
      toast.appendChild(undoBtn);
    }

    this.toastContainer.appendChild(toast);
    window.setTimeout(() => toast.remove(), TOAST_TIMEOUT_MS);
  }
}

function formatValue(value: unknown): string {
  if (value === undefined) {
    return "unset";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}
