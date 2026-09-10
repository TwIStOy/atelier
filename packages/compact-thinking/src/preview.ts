import { type Component, Text, truncateToWidth } from "@earendil-works/pi-tui";

export function formatThoughtDuration(durationMs: number): string {
  if (durationMs < 1_000) {
    return `${Math.max(1, Math.round(durationMs))}ms`;
  }

  const totalSeconds = Math.max(1, Math.round(durationMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

export class SingleLineText implements Component {
  private text: string;

  constructor(text: string) {
    this.text = text;
  }

  render(width: number): string[] {
    return [truncateToWidth(this.text, Math.max(0, width), "…")];
  }

  invalidate(): void {}
}

export class ActiveThinkingPreview implements Component {
  private heading: string;
  private text: string;
  private previewLines: number;
  private style: (text: string) => string;
  private cachedWidth = -1;
  private cachedLines: string[] | undefined;

  constructor(heading: string, text: string, previewLines: number, style: (text: string) => string) {
    this.heading = heading;
    this.text = text;
    this.previewLines = previewLines;
    this.style = style;
  }

  render(width: number): string[] {
    if (this.cachedLines !== undefined && width === this.cachedWidth) return this.cachedLines;

    const lines = new Text(this.style(this.text), 0, 0).render(width);
    const heading = new Text(this.heading, 0, 0).render(width);
    const result = [...heading, ...lines.slice(-this.previewLines)];
    this.cachedWidth = width;
    this.cachedLines = result;
    return result;
  }

  invalidate(): void {
    this.cachedWidth = -1;
    this.cachedLines = undefined;
  }
}

export class StrictThinkingPreview implements Component {
  private heading: string;
  private text: string;
  private style: (text: string) => string;
  private cachedWidth = -1;
  private cachedLines: string[] | undefined;

  constructor(heading: string, text: string, style: (text: string) => string) {
    this.heading = heading;
    this.text = text;
    this.style = style;
  }

  render(width: number): string[] {
    if (this.cachedLines !== undefined && width === this.cachedWidth) return this.cachedLines;

    const lines = new Text(this.style(this.text), 0, 0).render(width);
    const heading = new Text(this.heading + this.style(" ... (click to collapse)"), 0, 0).render(width);
    const result = [...heading, "", ...lines];
    this.cachedWidth = width;
    this.cachedLines = result;
    return result;
  }

  invalidate(): void {
    this.cachedWidth = -1;
    this.cachedLines = undefined;
  }
}
