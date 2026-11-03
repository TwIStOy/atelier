export interface GlyphSet {
  frame: {
    tl: string;
    tr: string;
    bl: string;
    br: string;
    h: string;
    v: string;
  };
  line: string;
  dot: string;
  ellipsis: string;
  ok: string;
  fail: string;
}

const GLYPHS: Record<"unicode" | "ascii", GlyphSet> = {
  unicode: {
    frame: { tl: "┏", tr: "┓", bl: "┗", br: "┛", h: "━", v: "┃" },
    line: "─",
    dot: " · ",
    ellipsis: "…",
    ok: "✓",
    fail: "✗",
  },
  ascii: {
    frame: { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|" },
    line: "-",
    dot: " - ",
    ellipsis: "...",
    ok: "+",
    fail: "x",
  },
};

export function glyphs(): GlyphSet {
  return GLYPHS.unicode;
}
