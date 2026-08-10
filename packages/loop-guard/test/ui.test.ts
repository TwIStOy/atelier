import assert from "node:assert/strict";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { describe, it } from "vitest";
import { RECOVERY_MESSAGE_TYPE, registerRecoveryRenderer } from "../src/ui.ts";

const passthroughTheme = { fg: (_color: string, text: string) => text } as unknown as Theme;

function captureRenderer() {
  let renderer: ((message: unknown, options: unknown, theme: Theme) => { render(width: number): string[] }) | undefined;
  const pi = {
    registerMessageRenderer(customType: string, r: typeof renderer) {
      assert.equal(customType, RECOVERY_MESSAGE_TYPE);
      renderer = r;
    },
  };
  registerRecoveryRenderer(pi as never);
  assert.ok(renderer);
  return renderer;
}

function renderBox(content: string, width: number): string[] {
  const renderer = captureRenderer();
  const component = renderer({ content }, { expanded: false, outputPad: 1 }, passthroughTheme);
  return component.render(width).map(stripTerminalSequences);
}

describe("loop-guard recovery message renderer", () => {
  it("renders a warning-bordered box with the loop-guard title", () => {
    const lines = renderBox("[loop-guard] THINKING LOOP DETECTED: stop repeating yourself.", 80);
    assert.match(lines[0], /^╭─ loop-guard ─+╮$/);
    assert.equal(lines.at(-1), `╰${"─".repeat(lines[0].length - 2)}╯`);
    const body = lines.slice(1, -1);
    assert.ok(body.length >= 1);
    for (const line of body) {
      assert.match(line, /^│.*│$/);
      assert.equal(line.length, lines[0].length);
    }
    assert.ok(body.some((line) => line.includes("THINKING LOOP DETECTED")));
  });

  it("strips the [loop-guard] prefix from the displayed content", () => {
    const lines = renderBox("[loop-guard] OUTPUT LOOP DETECTED: wrapped.", 80);
    assert.ok(!lines.some((line) => line.includes("[loop-guard]")));
  });

  it("shrinks the box to fit short content", () => {
    const lines = renderBox("short", 80);
    assert.ok(lines[0].length < 80);
  });

  it("caps the box width and wraps long content", () => {
    const lines = renderBox(`word `.repeat(60).trim(), 60);
    assert.ok(lines[0].length <= 60);
    assert.ok(lines.length > 3);
  });

  it("wraps realistic recovery text without clipping", () => {
    const content =
      "[loop-guard] THINKING LOOP DETECTED: your reasoning stream was repeating the same content verbatim, so it was aborted and the repeated section was truncated. Do not re-derive that reasoning.";
    const lines = renderBox(content, 90);
    const width = lines[0].length;
    for (const line of lines) {
      assert.equal(line.length, width);
    }
    const bodyText = lines
      .slice(1, -1)
      .map((line) => line.slice(1, -1).trim())
      .join(" ");
    for (const word of content.replace(/^\[loop-guard\]\s*/, "").split(" ")) {
      assert.ok(bodyText.includes(word), `missing word: ${word}`);
    }
  });

  it("keeps the label visible on narrow widths", () => {
    const lines = renderBox("content", 20);
    assert.ok(lines[0].includes("loop-guard"));
    for (const line of lines) {
      assert.ok(line.length <= 24);
    }
  });
});
