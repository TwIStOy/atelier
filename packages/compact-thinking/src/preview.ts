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

    const lines = this.wrapBodyText(width);
    const heading = new Text(this.headingText(), 0, 0).render(width);
    const result = this.compose(heading, lines);
    this.cachedWidth = width;
    this.cachedLines = result;
    return result;
  }

  protected wrapBodyText(width: number): string[] {
    return new Text(this.style(this.text), 0, 0).render(width);
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

  // Only the last previewLines visual lines are shown, and wrapping is per
  // source line (each source line yields at least one wrapped line, empty lines
  // included), so wrapping a suffix of the source lines yields the same tail
  // while keeping animation-tick renders O(preview) instead of O(total thinking
  // length).
  protected override wrapBodyText(width: number): string[] {
    const tail = lastLinesSuffix(this.text, this.previewLines);
    if (tail === undefined) return super.wrapBodyText(width);
    return new Text(this.style(tail), 0, 0).render(width);
  }

  protected compose(heading: string[], lines: string[]): string[] {
    return [...heading, ...lines.slice(-this.previewLines)];
  }
}

// Suffix starting at the last `count` line breaks, or undefined when the text
// has fewer than `count` newlines (callers wrap the whole text then).
function lastLinesSuffix(text: string, count: number): string | undefined {
  let index = text.length;
  for (let i = 0; i < count; i++) {
    const next = text.lastIndexOf("\n", index - 1);
    if (next === -1) return undefined;
    index = next;
  }
  return text.slice(index + 1);
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
