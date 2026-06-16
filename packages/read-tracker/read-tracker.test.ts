import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReadTracker } from "./read-tracker.ts";

function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rt-"));
  return path.join(dir, "f.txt");
}

describe("ReadTracker", () => {
  let file: string;
  let tracker: ReadTracker;

  beforeEach(() => {
    file = tmpFile();
    fs.writeFileSync(file, "hello");
    tracker = new ReadTracker();
  });

  afterEach(() => {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });

  it("records a read and allows subsequent edit", () => {
    tracker.record(file);
    expect(tracker.check(file)).toBeNull();
  });

  it("blocks edit on an unread existing file", () => {
    const res = tracker.check(file);
    expect(res).not.toBeNull();
    expect(res?.reason).toMatch(/Read the file before editing/);
  });

  it("blocks when file changed on disk after read", () => {
    tracker.record(file);
    const before = fs.statSync(file).mtimeMs;
    fs.writeFileSync(file, "changed content");
    const after = fs.statSync(file);
    if (after.mtimeMs === before) {
      const future = new Date(Date.now() + 5000);
      fs.utimesSync(file, future, future);
    }
    const res = tracker.check(file);
    expect(res).not.toBeNull();
    expect(res?.reason).toMatch(/modified since/);
  });

  it("refresh after write re-allows subsequent edits", () => {
    tracker.record(file);
    fs.writeFileSync(file, "changed content");
    expect(tracker.check(file)).not.toBeNull();
    tracker.refresh(file);
    expect(tracker.check(file)).toBeNull();
  });

  it("allows editing a not-yet-existing file (new file)", () => {
    const missing = path.join(path.dirname(file), "does-not-exist.ts");
    expect(tracker.check(missing)).toBeNull();
  });

  it("checkVerbose reports outcomes", () => {
    expect(tracker.checkVerbose(file).outcome).toBe("unread");
    tracker.record(file);
    expect(tracker.checkVerbose(file).outcome).toBe("ok");
    fs.writeFileSync(file, "changed content");
    expect(tracker.checkVerbose(file).outcome).toBe("stale");
  });

  it("collapses case-different paths via realpath", () => {
    tracker.record(file);
    const same = fs.realpathSync(file);
    expect(tracker.check(same)).toBeNull();
  });

  it("clear empties the log", () => {
    tracker.record(file);
    expect(tracker.paths().length).toBe(1);
    tracker.clear();
    expect(tracker.paths().length).toBe(0);
  });
});
