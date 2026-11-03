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

abstract class CachedThinkingPreview implements Component {
  protected heading: string;
  protected text: string;
  protected style: (text: string) => string;
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
    const heading = new Text(this.headingText(), 0, 0).render(width);
    const result = this.compose(heading, lines);
    this.cachedWidth = width;
    this.cachedLines = result;
    return result;
  }

  invalidate(): void {
    this.cachedWidth = -1;
    this.cachedLines = undefined;
  }

  protected abstract headingText(): string;
  protected abstract compose(heading: string[], lines: string[]): string[];
}

export class ActiveThinkingPreview extends CachedThinkingPreview {
  private previewLines: number;

  constructor(heading: string, text: string, previewLines: number, style: (text: string) => string) {
    super(heading, text, style);
    this.previewLines = previewLines;
  }

  protected headingText(): string {
    return this.heading;
  }

  protected compose(heading: string[], lines: string[]): string[] {
    return [...heading, ...lines.slice(-this.previewLines)];
  }
}

export class StrictThinkingPreview extends CachedThinkingPreview {
  constructor(heading: string, text: string, style: (text: string) => string) {
    super(heading, text, style);
  }

  protected headingText(): string {
    return this.heading + this.style(" ... (click to collapse)");
  }

  protected compose(heading: string[], lines: string[]): string[] {
    return [...heading, "", ...lines];
  }
}
