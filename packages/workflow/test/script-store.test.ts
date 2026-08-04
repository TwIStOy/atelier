import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listSavedWorkflows, normalizeWorkflowCommandName, saveWorkflowScript } from "../src/script-store.ts";

const SCRIPT = `export const meta = { name: "nightly-audit", description: "Nightly repo audit" };
return 1;`;

describe("script-store", () => {
  let home: string;
  let cwd: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "wf-home-"));
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "wf-cwd-"));
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("normalizes command names", () => {
    expect(normalizeWorkflowCommandName("Nightly Audit")).toBe("nightly-audit");
    expect(normalizeWorkflowCommandName("!!!")).toBe("");
  });

  it("saves a script to the user scope and discovers it", () => {
    const saved = saveWorkflowScript("Nightly Audit", SCRIPT, "user", cwd, home);
    expect(saved.name).toBe("nightly-audit");
    expect(fs.existsSync(saved.path)).toBe(true);

    const listed = listSavedWorkflows(cwd, home);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ name: "nightly-audit", description: "Nightly repo audit", scope: "user" });
  });

  it("project scope wins over user scope on name conflicts", () => {
    saveWorkflowScript("nightly-audit", SCRIPT, "user", cwd, home);
    const projectScript = SCRIPT.replace("Nightly repo audit", "Project audit");
    saveWorkflowScript("nightly-audit", projectScript, "project", cwd, home);

    const listed = listSavedWorkflows(cwd, home);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.scope).toBe("project");
    expect(listed[0]?.description).toBe("Project audit");
  });

  it("skips files that do not parse as workflows", () => {
    const dir = path.join(home, ".config", "pi", "workflows");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "broken.js"), "const x = 1;");
    fs.writeFileSync(path.join(dir, "notes.txt"), SCRIPT);
    expect(listSavedWorkflows(cwd, home)).toEqual([]);
  });

  it("rejects invalid names and invalid scripts", () => {
    expect(() => saveWorkflowScript("!!!", SCRIPT, "user", cwd, home)).toThrow("invalid workflow command name");
    expect(() => saveWorkflowScript("ok-name", "const x = 1;", "user", cwd, home)).toThrow("invalid workflow script");
  });

  it("refuses to write through a symlinked workflows directory", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "wf-outside-"));
    const dir = path.join(home, ".config", "pi");
    fs.mkdirSync(dir, { recursive: true });
    fs.symlinkSync(outside, path.join(dir, "workflows"));
    expect(() => saveWorkflowScript("nightly-audit", SCRIPT, "user", cwd, home)).toThrow("symlink");
    fs.rmSync(outside, { recursive: true, force: true });
  });
});
