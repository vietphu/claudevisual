// Hand-rolled canvas rendering — no chart library, per the plan's tech-stack
// constraint. Maintains a small bounded ring buffer per session (host-side
// session-state-store.ts already only sends a diff when something changed,
// so this is genuinely incremental, not a resend of full history) and
// re-renders the three charts for the most-recently-updated ("primary")
// session, mirroring status-bar.ts's own "most recently updated" heuristic.
import type { ChartPoint } from "../webview/charts";

const MAX_POINTS_PER_SESSION = 120;

const COLORS = {
  input: "#4f8cff",
  output: "#34c38f",
  cacheRead: "#f1b44c",
  cacheCreation: "#ff6b6b",
  cost: "#4f8cff",
  context: "#ff6b6b",
};

interface SessionSeries {
  points: ChartPoint[];
}

export class ChartView {
  private readonly seriesBySession = new Map<string, SessionSeries>();
  private primarySessionId: string | undefined;

  constructor(
    private readonly tokenCanvas: HTMLCanvasElement,
    private readonly costCanvas: HTMLCanvasElement,
    private readonly contextCanvas: HTMLCanvasElement
  ) {}

  applyPoints(points: ChartPoint[]): void {
    for (const point of points) {
      const series = this.seriesBySession.get(point.sessionId) ?? { points: [] };
      series.points.push(point);
      if (series.points.length > MAX_POINTS_PER_SESSION) {
        series.points.shift();
      }
      this.seriesBySession.set(point.sessionId, series);
      this.primarySessionId = point.sessionId;
    }
    if (points.length > 0) {
      this.render();
    }
  }

  private render(): void {
    const series = this.primarySessionId ? this.seriesBySession.get(this.primarySessionId) : undefined;
    const points = series?.points ?? [];
    this.renderStackedTokens(points);
    this.renderCost(points);
    this.renderContextSparkline(points);
  }

  private renderStackedTokens(points: ChartPoint[]): void {
    const ctx = this.tokenCanvas.getContext("2d");
    if (!ctx) {
      return;
    }
    const { width, height } = this.tokenCanvas;
    ctx.clearRect(0, 0, width, height);
    if (points.length === 0) {
      return;
    }

    const maxTotal = Math.max(
      1,
      ...points.map((p) => p.inputTokens + p.outputTokens + p.cacheReadTokens + p.cacheCreationTokens)
    );
    const barWidth = width / points.length;

    points.forEach((p, i) => {
      const x = i * barWidth;
      let y = height;
      const segments: Array<[number, string]> = [
        [p.inputTokens, COLORS.input],
        [p.outputTokens, COLORS.output],
        [p.cacheReadTokens, COLORS.cacheRead],
        [p.cacheCreationTokens, COLORS.cacheCreation],
      ];
      for (const [value, color] of segments) {
        const segHeight = (value / maxTotal) * height;
        ctx.fillStyle = color;
        ctx.fillRect(x, y - segHeight, Math.max(1, barWidth - 1), segHeight);
        y -= segHeight;
      }
    });
  }

  private renderCost(points: ChartPoint[]): void {
    const ctx = this.costCanvas.getContext("2d");
    if (!ctx) {
      return;
    }
    const { width, height } = this.costCanvas;
    ctx.clearRect(0, 0, width, height);
    const withCost = points.filter((p): p is ChartPoint & { costUsd: number } => p.costUsd !== undefined);
    if (withCost.length === 0) {
      return;
    }
    const maxCost = Math.max(...withCost.map((p) => p.costUsd), 0.01);
    this.drawLine(
      ctx,
      width,
      height,
      withCost.map((p) => p.costUsd / maxCost),
      COLORS.cost
    );
  }

  private renderContextSparkline(points: ChartPoint[]): void {
    const ctx = this.contextCanvas.getContext("2d");
    if (!ctx) {
      return;
    }
    const { width, height } = this.contextCanvas;
    ctx.clearRect(0, 0, width, height);
    const withContext = points.filter((p): p is ChartPoint & { contextPercent: number } => p.contextPercent !== undefined);
    if (withContext.length === 0) {
      return;
    }
    this.drawLine(
      ctx,
      width,
      height,
      withContext.map((p) => p.contextPercent / 100),
      COLORS.context
    );
  }

  /** Draws a normalized (0..1) line series, hand-rolled — no chart library. */
  private drawLine(ctx: CanvasRenderingContext2D, width: number, height: number, normalized: number[], color: string): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    normalized.forEach((v, i) => {
      const x = (i / Math.max(1, normalized.length - 1)) * width;
      const y = height - v * height;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
  }
}
