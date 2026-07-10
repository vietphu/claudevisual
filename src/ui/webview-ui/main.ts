// Webview dashboard entry point (Phase 5) — bundled by esbuild's separate
// browser-target `webviewConfig` (esbuild.js) into dist/webview/main.js,
// referenced by panel.ts's HTML. Wires the two dashboard sections (charts +
// config form) to the host<->webview message protocol (../webview/messages.ts).
import type { HostToWebviewMessage } from "../webview/messages";
import { ChartView } from "./chart-view";
import { ConfigFormView } from "./config-form-view";
import { onHostMessage, postToHost } from "./vscode-api";

function mount(): void {
  const root = document.getElementById("root");
  if (!root) {
    return;
  }

  root.innerHTML = `
    <section class="cv-charts">
      <h2>Token usage (stacked: input / output / cache-read / cache-creation)</h2>
      <canvas id="cv-token-chart" width="600" height="140"></canvas>
      <h2>Cost (session, cumulative)</h2>
      <canvas id="cv-cost-chart" width="600" height="80"></canvas>
      <h2>Context window %</h2>
      <canvas id="cv-context-chart" width="600" height="80"></canvas>
    </section>
    <section class="cv-config-form" id="cv-config-form"></section>
    <div id="cv-toast-container" class="cv-toast-container"></div>
  `;

  // Non-null assertions below are safe: every queried id was just written
  // into `root.innerHTML` on the line above, unconditionally.
  const chartView = new ChartView(
    root.querySelector<HTMLCanvasElement>("#cv-token-chart")!,
    root.querySelector<HTMLCanvasElement>("#cv-cost-chart")!,
    root.querySelector<HTMLCanvasElement>("#cv-context-chart")!
  );

  const formView = new ConfigFormView(
    root.querySelector<HTMLElement>("#cv-config-form")!,
    root.querySelector<HTMLElement>("#cv-toast-container")!
  );

  onHostMessage((message: HostToWebviewMessage) => {
    switch (message.type) {
      case "init":
        formView.renderInit(message.fields, message.hasProjectScope);
        break;
      case "metrics-diff":
        chartView.applyPoints(message.points);
        break;
      case "write-result":
        formView.handleWriteResult(message);
        break;
      case "undo-result":
        formView.handleUndoResult(message.fieldId, message.ok, message.error);
        break;
      default:
        break;
    }
  });

  postToHost({ type: "ready" });
}

mount();
