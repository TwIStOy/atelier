import type { Component } from "@earendil-works/pi-tui";

export type GutterBar = string | ((row: number, rows: number) => string);

export class Gutter implements Component {
  private inner: Component;
  private pad: number;
  private bar: GutterBar;

  constructor(inner: Component, pad: number, bar: GutterBar) {
    this.inner = inner;
    this.pad = pad;
    this.bar = bar;
  }

  render(width: number): string[] {
    const lines = this.inner.render(width);
    return lines.map((line, row) => {
      if (line.length < this.pad + 2) return line;
      const bar = typeof this.bar === "function" ? this.bar(row, lines.length) : this.bar;
      return `${line.slice(0, this.pad)}${bar} ${line.slice(this.pad + 2)}`;
    });
  }

  invalidate(): void {
    this.inner.invalidate();
  }
}
