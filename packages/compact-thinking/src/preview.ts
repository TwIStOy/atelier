import { type Component, getKeybindings, Text } from "@earendil-works/pi-tui";

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

function getThinkingToggleHint(): string | undefined {
  const keys = getKeybindings().getKeys("app.thinking.toggle");
  return keys.length > 0 ? `${keys.join("/")} to expand` : undefined;
}

export class StrictThinkingPreview implements Component {
  private heading: string;
  private text: string;
  private padding: number;
  private style: (text: string) => string;
  private previewLines: number;
  private cachedWidth = -1;
  private cachedLines: string[] | undefined;

  constructor(heading: string, text: string, padding: number, style: (text: string) => string, previewLines: number) {
    this.heading = heading;
    this.text = text;
    this.padding = padding;
    this.style = style;
    this.previewLines = previewLines;
  }

  render(width: number): string[] {
    if (this.cachedLines !== undefined && width === this.cachedWidth) return this.cachedLines;

    const lines = new Text(this.style(this.text), this.padding, 0).render(width);

    let hint: string | undefined;
    const hiddenLines = lines.length - this.previewLines;
    if (hiddenLines > 0) {
      const noun = hiddenLines === 1 ? "line" : "lines";
      const toggleHint = getThinkingToggleHint();
      hint = ` ... (${hiddenLines} more ${noun}${toggleHint ? `, ${toggleHint}` : ""})`;
    }

    const heading = new Text(this.heading + (hint ? this.style(hint) : ""), this.padding, 0).render(width);
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
