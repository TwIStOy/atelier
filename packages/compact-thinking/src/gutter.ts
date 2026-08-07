import type { Component } from "@earendil-works/pi-tui";

export class Gutter implements Component {
  private inner: Component;
  private pad: number;
  private bar: string;

  constructor(inner: Component, pad: number, bar: string) {
    this.inner = inner;
    this.pad = pad;
    this.bar = bar;
  }

  render(width: number): string[] {
    return this.inner
      .render(width)
      .map((line) =>
        line.length >= this.pad + 2 ? `${line.slice(0, this.pad)}${this.bar} ${line.slice(this.pad + 2)}` : line,
      );
  }

  invalidate(): void {
    this.inner.invalidate();
  }
}
