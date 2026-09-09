import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, test } from "vitest";
import {
  RAIL_BULLET_AGGREGATE,
  RAIL_BULLET_SINGLE,
  renderRailLines,
  TOOL_RAIL_LAYOUT,
  ToolRailComponent,
  toolRailBodyWidth,
} from "../src/tool-rail.ts";

const PLAIN_THEME: Theme = {
  fg: (_c: string, text: string) => text,
  bg: (_c: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

const ANSI_CODES: Record<string, string> = { success: "32", error: "31", dim: "90" };
const ANSI_THEME: Theme = {
  fg: (color: string, text: string) => `\x1b[${ANSI_CODES[color]}m${text}\x1b[39m`,
  bg: (_c: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

describe("TOOL_RAIL_LAYOUT", () => {
  test("pins the grok-build column contract", () => {
    expect(TOOL_RAIL_LAYOUT).toEqual({ railColumn: 2, bulletColumn: 5, bodyColumn: 7, prefixWidth: 7 });
  });
});

describe("toolRailBodyWidth", () => {
  test("subtracts the shared prefix from the terminal width", () => {
    expect(toolRailBodyWidth(80)).toBe(73);
    expect(toolRailBodyWidth(TOOL_RAIL_LAYOUT.prefixWidth)).toBe(0);
  });

  test("never goes below zero", () => {
    expect(toolRailBodyWidth(0)).toBe(0);
    expect(toolRailBodyWidth(3)).toBe(0);
  });
});

describe("renderRailLines single-line block", () => {
  test("keeps the empty rail placeholder, bullet at column 5, body at column 7", () => {
    const lines = renderRailLines(["Read foo.txt"], { mark: "none", bullet: RAIL_BULLET_SINGLE }, PLAIN_THEME, 80);
    expect(lines).toEqual(["     ◆ Read foo.txt"]);
  });
});

describe("renderRailLines run block", () => {
  test("keeps the rail on continuation rows with a blank bullet cell and aligned body", () => {
    const lines = renderRailLines(
      ["Run Locate mold binary", "stdout line 1", "stdout line 2"],
      { mark: "run", bullet: RAIL_BULLET_SINGLE },
      PLAIN_THEME,
      80,
    );
    expect(lines).toEqual(["  ┃  ◆ Run Locate mold binary", "  ┃    stdout line 1", "  ┃    stdout line 2"]);
  });

  test("trims trailing padding when a body line is empty", () => {
    const lines = renderRailLines(["a", ""], { mark: "run", bullet: RAIL_BULLET_SINGLE }, PLAIN_THEME, 80);
    expect(lines).toEqual(["  ┃  ◆ a", "  ┃"]);
  });
});

describe("renderRailLines aggregate row", () => {
  test("uses the aggregate rail glyph and aggregate bullet", () => {
    const lines = renderRailLines(
      ["Searched 20 patterns, Read 8 files"],
      { mark: "aggregate", bullet: RAIL_BULLET_AGGREGATE },
      PLAIN_THEME,
      80,
    );
    expect(lines).toEqual(["  ❙  ◈ Searched 20 patterns, Read 8 files"]);
  });
});

describe("renderRailLines spinner bullet", () => {
  test("renders a caller-supplied spinner frame in the bullet cell", () => {
    const lines = renderRailLines(["Bash build"], { mark: "none", bullet: "⠋" }, PLAIN_THEME, 80);
    expect(lines).toEqual(["     ⠋ Bash build"]);
  });
});

describe("renderRailLines status coloring", () => {
  test("colors the rail and bullet green for success, leaving the body unstyled", () => {
    const lines = renderRailLines(
      ["Read foo", "continued"],
      { mark: "run", bullet: RAIL_BULLET_SINGLE, status: "success" },
      ANSI_THEME,
      80,
    );
    expect(lines[0]).toBe("  \x1b[32m┃\x1b[39m  \x1b[32m◆\x1b[39m Read foo");
    expect(lines[1]).toBe("  \x1b[32m┃\x1b[39m    continued");
    expect(lines.map(stripTerminalSequences)).toEqual(["  ┃  ◆ Read foo", "  ┃    continued"]);
  });

  test("colors the rail and bullet red for error", () => {
    const lines = renderRailLines(
      ["Read foo"],
      { mark: "none", bullet: RAIL_BULLET_SINGLE, status: "error" },
      ANSI_THEME,
      80,
    );
    expect(lines[0]).toBe("     \x1b[31m◆\x1b[39m Read foo");
  });

  test("colors the rail and bullet dim", () => {
    const lines = renderRailLines(
      ["Thought for 5.0s"],
      { mark: "none", bullet: RAIL_BULLET_SINGLE, status: "dim" },
      ANSI_THEME,
      80,
    );
    expect(lines[0]).toBe("     \x1b[90m◆\x1b[39m Thought for 5.0s");
    expect(stripTerminalSequences(lines[0])).toBe("     ◆ Thought for 5.0s");
  });
});

describe("renderRailLines custom bar", () => {
  test("accepts a static string bar", () => {
    const lines = renderRailLines(
      ["Thinking…"],
      { mark: "none", bullet: RAIL_BULLET_SINGLE, bar: "▌" },
      PLAIN_THEME,
      80,
    );
    expect(lines).toEqual(["  ▌  ◆ Thinking…"]);
  });

  test("passes the 0-based row and total row count to the callback", () => {
    const seen: Array<[number, number]> = [];
    const lines = renderRailLines(
      ["a", "b"],
      {
        mark: "none",
        bullet: RAIL_BULLET_SINGLE,
        bar: (row, rows) => {
          seen.push([row, rows]);
          return `[${row}]`;
        },
      },
      PLAIN_THEME,
      80,
    );
    expect(seen).toEqual([
      [0, 2],
      [1, 2],
    ]);
    expect(lines).toEqual(["  [0]◆ a", "  [1]  b"]);
  });

  test("uses callback rail output as-is, without status recoloring the rail", () => {
    const waveBar = (row: number) => `\x1b[38;2;${80 + row};80;80m▌\x1b[39m`;
    const lines = renderRailLines(
      ["summarizing", "row2"],
      { mark: "none", bullet: RAIL_BULLET_SINGLE, status: "dim", bar: waveBar },
      ANSI_THEME,
      80,
    );
    expect(lines[0]).toBe("  \x1b[38;2;80;80;80m▌\x1b[39m  \x1b[90m◆\x1b[39m summarizing");
    expect(lines[1]).toBe("  \x1b[38;2;81;80;80m▌\x1b[39m    row2");
  });

  test("re-evaluates the bar callback on every render", () => {
    let frame = 0;
    const bar = () => `\x1b[38;2;${frame};0;0m▌\x1b[39m`;
    const spec = { mark: "none" as const, bullet: RAIL_BULLET_SINGLE, bar };
    const bodyLines = ["thinking"];
    const first = renderRailLines(bodyLines, spec, PLAIN_THEME, 80);
    frame = 10;
    const second = renderRailLines(bodyLines, spec, PLAIN_THEME, 80);
    expect(first[0]).toContain("\x1b[38;2;0;0;0m");
    expect(second[0]).toContain("\x1b[38;2;10;0;0m");
  });
});

describe("renderRailLines width truncation", () => {
  const bodies = [
    "plain ascii body that is long enough to need truncation at narrow widths",
    "中文内容宽度测试需要截断的很长文本继续加长以便超过宽度限制",
    "mixed 中English 文本 with emoji 🎉 and more text to overflow the budget",
    "\x1b[31mstyled body\x1b[39m with ansi codes and 中文 and a very long tail to force truncation",
  ];
  const specs = [
    { mark: "none" as const, bullet: RAIL_BULLET_SINGLE, status: "success" as const },
    { mark: "run" as const, bullet: RAIL_BULLET_SINGLE, status: "error" as const },
    { mark: "aggregate" as const, bullet: RAIL_BULLET_AGGREGATE },
    { mark: "none" as const, bullet: "⠋", bar: "▌" },
  ];

  test.each(bodies.map((body, i) => [i, body] as const))("never exceeds the width for body #%i", (_i, body) => {
    for (const width of [0, 1, 2, 6, 7, 8, 12, 30]) {
      for (const spec of specs) {
        const lines = renderRailLines([body, body], spec, ANSI_THEME, width);
        expect(lines.length).toBe(2);
        for (const line of lines) {
          expect(visibleWidth(line)).toBeLessThanOrEqual(width);
        }
      }
    }
  });

  test("returns empty lines at width 0", () => {
    const lines = renderRailLines(["body"], { mark: "run", bullet: RAIL_BULLET_SINGLE }, PLAIN_THEME, 0);
    expect(lines).toEqual([""]);
  });

  test("truncates CJK body with an ellipsis at a narrow width", () => {
    const lines = renderRailLines(["中文测试"], { mark: "none", bullet: RAIL_BULLET_SINGLE }, PLAIN_THEME, 10);
    expect(stripTerminalSequences(lines[0])).toBe("     ◆ 中…");
  });

  test("drops a wide grapheme that does not fit and keeps the ellipsis", () => {
    const lines = renderRailLines(["🎉🎉🎉"], { mark: "none", bullet: RAIL_BULLET_SINGLE }, PLAIN_THEME, 8);
    expect(stripTerminalSequences(lines[0])).toBe("     ◆ …");
  });

  test("keeps the full body when the width is sufficient", () => {
    const lines = renderRailLines(["Read foo"], { mark: "none", bullet: RAIL_BULLET_SINGLE }, PLAIN_THEME, 80);
    expect(lines[0]).toBe("     ◆ Read foo");
  });
});

describe("ToolRailComponent", () => {
  test("renders the inner component at the body width and composes the rail", () => {
    const widths: number[] = [];
    const inner: Component = {
      render(width: number) {
        widths.push(width);
        return ["line one", "line two"];
      },
      invalidate() {},
    };
    const component = new ToolRailComponent(
      inner,
      { mark: "run", bullet: RAIL_BULLET_SINGLE, status: "success" },
      ANSI_THEME,
    );
    expect(component.render(30)).toEqual([
      "  \x1b[32m┃\x1b[39m  \x1b[32m◆\x1b[39m line one",
      "  \x1b[32m┃\x1b[39m    line two",
    ]);
    expect(widths).toEqual([toolRailBodyWidth(30)]);
  });

  test("propagates invalidate to the inner component", () => {
    let invalidated = 0;
    const inner: Component = {
      render: () => ["x"],
      invalidate: () => {
        invalidated++;
      },
    };
    const component = new ToolRailComponent(inner, { mark: "none", bullet: RAIL_BULLET_SINGLE }, PLAIN_THEME);
    component.invalidate();
    expect(invalidated).toBe(1);
  });

  test("advances bar animation between renders of the same instance", () => {
    let frame = 0;
    const inner: Component = { render: () => ["thinking"], invalidate() {} };
    const component = new ToolRailComponent(
      inner,
      { mark: "none", bullet: RAIL_BULLET_SINGLE, bar: () => `\x1b[38;2;${frame};0;0m▌\x1b[39m` },
      PLAIN_THEME,
    );
    const first = component.render(40);
    frame = 5;
    const second = component.render(40);
    expect(first[0]).toContain("\x1b[38;2;0;0;0m");
    expect(second[0]).toContain("\x1b[38;2;5;0;0m");
  });
});

describe("grok-build scrollback example", () => {
  test("reproduces the issue's worked example column-for-column", () => {
    const render = (body: string, mark: Parameters<typeof renderRailLines>[1]["mark"], bullet: string) =>
      renderRailLines([body], { mark, bullet }, PLAIN_THEME, 80)[0];
    expect(
      [
        render("Searched 20 patterns, Read 8 files, Listed 3 dirs", "aggregate", RAIL_BULLET_AGGREGATE),
        render("Run Locate mold binary on host and in output", "run", RAIL_BULLET_SINGLE),
        render("Task started: Git history for mold linker", "none", RAIL_BULLET_SINGLE),
        render("Searched 3 patterns", "aggregate", RAIL_BULLET_AGGREGATE),
        render("Thought for 5.0s", "none", RAIL_BULLET_SINGLE),
      ].join("\n"),
    ).toEqual(
      [
        "  ❙  ◈ Searched 20 patterns, Read 8 files, Listed 3 dirs",
        "  ┃  ◆ Run Locate mold binary on host and in output",
        "     ◆ Task started: Git history for mold linker",
        "  ❙  ◈ Searched 3 patterns",
        "     ◆ Thought for 5.0s",
      ].join("\n"),
    );
  });
});
