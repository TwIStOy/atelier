import { describe, expect, it } from "vitest";
import { parseFishVariables } from "../src/parse.ts";

const RS = "\x1e";

describe("parseFishVariables - line filtering", () => {
  it("skips comment lines and blank lines", () => {
    const content = `# This file contains fish universal variable definitions.
# VERSION: 3.0

SETUVAR --export FOO:bar
`;
    const vars = parseFishVariables(content);
    expect(vars).toHaveLength(1);
    expect(vars[0]).toMatchObject({ name: "FOO", values: ["bar"], exported: true, pathvar: false });
  });

  it("ignores lines that do not start with SETUVAR", () => {
    const content = ["SETUVAR --export FOO:bar", "garbage line", "SETUVAR BAZ:qux"].join("\n");
    const vars = parseFishVariables(content);
    expect(vars.map((v) => v.name)).toEqual(["FOO", "BAZ"]);
  });

  it("tolerates a SETUVAR line with no colon as skipped, not throwing", () => {
    const content = "SETUVAR --export NOCOLON\nSETUVAR FOO:bar\n";
    const vars = parseFishVariables(content);
    expect(vars.map((v) => v.name)).toEqual(["FOO"]);
  });
});

describe("parseFishVariables - flag parsing", () => {
  it("parses --export before the name (fish 4.x format)", () => {
    const vars = parseFishVariables("SETUVAR --export FOO:bar");
    expect(vars[0]).toMatchObject({ exported: true, pathvar: false });
  });

  it("parses --path before the name", () => {
    const vars = parseFishVariables("SETUVAR --export --path PATH:/usr/bin");
    expect(vars[0]).toMatchObject({ name: "PATH", exported: true, pathvar: true });
  });

  it("parses --path without --export (not exported, should still parse)", () => {
    const vars = parseFishVariables("SETUVAR --path PATH:/usr/bin");
    expect(vars[0]).toMatchObject({ pathvar: true, exported: false });
  });

  it("treats a var with no flags as not exported and not pathvar", () => {
    const vars = parseFishVariables("SETUVAR PRIVATE:hush");
    expect(vars[0]).toMatchObject({ exported: false, pathvar: false });
  });

  it("skips unknown --flags without breaking parsing (forward compat)", () => {
    const vars = parseFishVariables("SETUVAR --futureflag --export FOO:bar");
    expect(vars[0]).toMatchObject({ name: "FOO", values: ["bar"], exported: true });
  });

  it("parses flags in any order", () => {
    const v1 = parseFishVariables("SETUVAR --path --export X:a");
    const v2 = parseFishVariables("SETUVAR --export --path X:a");
    expect(v1[0]).toMatchObject({ exported: true, pathvar: true });
    expect(v2[0]).toMatchObject({ exported: true, pathvar: true });
  });
});

describe("parseFishVariables - value unescaping", () => {
  it("unescapes \\x20 to a space", () => {
    const vars = parseFishVariables("SETUVAR --export BAZ:hello\\x20world");
    expect(vars[0].values).toEqual(["hello world"]);
  });

  it("unescapes \\x3a to a colon inside a value", () => {
    const vars = parseFishVariables("SETUVAR --export QUOTED:a\\x3ab\\x3ac");
    expect(vars[0].values).toEqual(["a:b:c"]);
  });

  it("unescapes a literal backslash (\\x5c\\x5c -> backslash backslash)", () => {
    const vars = parseFishVariables("SETUVAR --export BS:\\x5c");
    expect(vars[0].values).toEqual(["\\"]);
  });

  it("unescapes named escapes: \\n \\t \\r", () => {
    const vars = parseFishVariables("SETUVAR --export NL:a\\nb\\tc\\r");
    expect(vars[0].values).toEqual(["a\nb\tc\r"]);
  });

  it("unescapes \\e (escape), \\a (bell), \\b (backspace), \\f, \\v", () => {
    const vars = parseFishVariables("SETUVAR --export E:\\e\\a\\b\\f\\v");
    expect(vars[0].values).toEqual(["\x1b\x07\x08\x0c\x0b"]);
  });

  it("unescapes \\uHHHH to a unicode codepoint", () => {
    const vars = parseFishVariables("SETUVAR --export U:\\u00e9");
    expect(vars[0].values).toEqual(["é"]);
  });

  it("unescapes \\UHHHHHHHH for codepoints above BMP", () => {
    const vars = parseFishVariables("SETUVAR --export U:\\U0001f600");
    expect(vars[0].values).toEqual(["😀"]);
  });

  it("passes alphanumeric, slash, underscore through unescaped", () => {
    const vars = parseFishVariables("SETUVAR --export P:/usr/local/bin_2");
    expect(vars[0].values).toEqual(["/usr/local/bin_2"]);
  });

  it("drops the backslash before an unrecognized escape char (matches fish uvars path)", () => {
    const vars = parseFishVariables("SETUVAR --export Q:\\z");
    expect(vars[0].values).toEqual(["z"]);
  });
});

describe("parseFishVariables - list splitting", () => {
  it("splits a value on the \\x1e record separator AFTER unescaping", () => {
    const content = `SETUVAR --export MY_LIST:a${RS}b${RS}c`;
    const vars = parseFishVariables(content);
    expect(vars[0].values).toEqual(["a", "b", "c"]);
    expect(vars[0].pathvar).toBe(false);
  });

  it("splits a pathvar value on \\x1e", () => {
    const content = `SETUVAR --export --path PATH:/usr/local/bin${RS}/usr/bin${RS}/bin`;
    const vars = parseFishVariables(content);
    expect(vars[0].values).toEqual(["/usr/local/bin", "/usr/bin", "/bin"]);
    expect(vars[0].pathvar).toBe(true);
  });

  it("produces a single-element list for a non-list value", () => {
    const vars = parseFishVariables("SETUVAR --export SINGLE:value");
    expect(vars[0].values).toEqual(["value"]);
  });

  it("preserves spaces inside individual list elements", () => {
    const content = `SETUVAR --export WITH_SPACES:two\\x20words${RS}three\\x20words\\x20here`;
    const vars = parseFishVariables(content);
    expect(vars[0].values).toEqual(["two words", "three words here"]);
  });
});

describe("parseFishVariables - real fish 4.2.1 output", () => {
  it("parses a verbatim sample captured from fish 4.2.1", () => {
    const real = [
      "# This file contains fish universal variable definitions.",
      "# VERSION: 3.0",
      "SETUVAR --export BAZ:hello\\x20world",
      "SETUVAR --export FISH_USER_PATHS:/opt/a\\x1e/opt/b",
      "SETUVAR --export FOO:bar",
      "SETUVAR --export --path PATH:/usr/local/bin\\x1e/usr/bin\\x1e/bin",
      "SETUVAR PRIVATE_SECRET:hush",
      "SETUVAR --export QUOTED:a\\x3ab\\x3ac",
      "SETUVAR --export WITH_BACKSLASH:line1\\x5c\\x5cnline2",
    ].join("\n");
    const vars = parseFishVariables(real);
    const byName = Object.fromEntries(vars.map((v) => [v.name, v]));
    expect(byName.BAZ).toMatchObject({ exported: true, values: ["hello world"] });
    expect(byName.FISH_USER_PATHS.values).toEqual(["/opt/a", "/opt/b"]);
    expect(byName.FOO).toMatchObject({ exported: true, values: ["bar"] });
    expect(byName.PATH.pathvar).toBe(true);
    expect(byName.PATH.values).toEqual(["/usr/local/bin", "/usr/bin", "/bin"]);
    expect(byName.PRIVATE_SECRET.exported).toBe(false);
    expect(byName.QUOTED.values).toEqual(["a:b:c"]);
    expect(byName.WITH_BACKSLASH.values).toEqual(["line1\\\\nline2"]);
  });
});
