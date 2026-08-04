import { describe, expect, it } from "vitest";
import { normalizeWorkflowScript, parseWorkflowScript } from "../src/script.ts";

const META = `export const meta = { name: "audit", description: "Audit the codebase" };`;

describe("normalizeWorkflowScript", () => {
  it("strips js code fences", () => {
    expect(normalizeWorkflowScript("```js\nconst a = 1;\n```")).toBe("const a = 1;");
  });

  it("strips bare fences", () => {
    expect(normalizeWorkflowScript("```\nconst a = 1;\n```")).toBe("const a = 1;");
  });

  it("keeps plain source untouched", () => {
    expect(normalizeWorkflowScript("  const a = 1;  ")).toBe("const a = 1;");
  });
});

describe("parseWorkflowScript", () => {
  it("parses a valid script and strips the export keyword", () => {
    const result = parseWorkflowScript(`${META}\nconst x = 1;\nreturn x;`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.script.meta).toEqual({ name: "audit", description: "Audit the codebase" });
    expect(result.script.body).not.toContain("export");
    expect(result.script.body).toContain("const meta =");
    expect(result.script.body).toContain("return x;");
  });

  it("rejects an empty script", () => {
    const result = parseWorkflowScript("   ");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("empty");
  });

  it("rejects syntax errors with the acorn message", () => {
    const result = parseWorkflowScript(`${META}\nconst = ;`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("does not parse");
  });

  it("rejects a missing meta export", () => {
    const result = parseWorkflowScript(`const x = 1;`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("export const meta");
  });

  it("rejects meta that is not a const object literal", () => {
    for (const src of [
      `export const meta = buildMeta();`,
      `export let meta = { name: "a", description: "b" };`,
      `export const other = { name: "a", description: "b" };`,
      `export const meta = { name: "a", description: "b" }, extra = 1;`,
    ]) {
      const result = parseWorkflowScript(src);
      expect(result.ok).toBe(false);
    }
  });

  it("rejects non-literal meta values", () => {
    for (const src of [
      `export const meta = { name: "a", description: "b", ...spread };`,
      `export const meta = { name: "a", description: "b", ["k" + "e"]: 1 };`,
      `export const meta = { name: "a", description: "b", run() {} };`,
      `export const meta = { name: "a", description: "b", __proto__: { x: 1 } };`,
      `export const meta = { name: \`a ${"${"}x}\`, description: "b" };`,
    ]) {
      const result = parseWorkflowScript(src);
      expect(result.ok).toBe(false);
    }
  });

  it("accepts nested literal meta extras", () => {
    const result = parseWorkflowScript(
      `export const meta = { name: "a", description: "b", phases: ["one", "two"], retries: -2, flags: { deep: true } };`,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects missing name or description", () => {
    expect(parseWorkflowScript(`export const meta = { description: "b" };`).ok).toBe(false);
    expect(parseWorkflowScript(`export const meta = { name: "", description: "b" };`).ok).toBe(false);
    expect(parseWorkflowScript(`export const meta = { name: "a" };`).ok).toBe(false);
  });

  it("rejects imports and extra exports", () => {
    for (const src of [
      `import fs from "node:fs";\n${META}`,
      `${META}\nimport fs from "node:fs";`,
      `${META}\nexport const other = 1;`,
      `${META}\nexport default 1;`,
      `${META}\nconst fs = await import("node:fs");`,
    ]) {
      const result = parseWorkflowScript(src);
      expect(result.ok).toBe(false);
    }
  });

  it("rejects banned host identifiers as references", () => {
    for (const src of [
      `${META}\nprocess.exit(1);`,
      `${META}\nconst p = process;`,
      `${META}\nglobalThis.x = 1;`,
      `${META}\nconst F = Function;`,
      `${META}\neval("1");`,
      `${META}\nrequire("fs");`,
      `${META}\nWebAssembly.compile([]);`,
    ]) {
      const result = parseWorkflowScript(src);
      expect(result.ok).toBe(false);
    }
  });

  it("allows banned words as property keys and member accesses", () => {
    const result = parseWorkflowScript(
      `${META}\nconst a = { process: 1, eval: 2 };\nconst b = a.process + a.eval;\nobj.globalThis = 3;`,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects with statements", () => {
    const result = parseWorkflowScript(`${META}\nwith (obj) { x = 1; }`);
    expect(result.ok).toBe(false);
  });
});
