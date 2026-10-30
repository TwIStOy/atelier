import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export function writeChildSession(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `child-${crypto.randomBytes(4).toString("hex")}.jsonl`);
  const entryId = () => crypto.randomBytes(4).toString("hex");
  const timestamp = new Date().toISOString();
  const header = {
    type: "session",
    version: 3,
    id: "h1",
    timestamp,
    cwd: dir,
    parentSession: "parent-fixture",
  };
  const entry = (id: string, parentId: string, message: unknown) =>
    JSON.stringify({ type: "message", id, parentId, timestamp, message });
  const userId = entryId();
  const lines = [
    JSON.stringify(header),
    entry(userId, "h1", { role: "user", content: [{ type: "text", text: "summarize the repo" }] }),
    entry(entryId(), userId, { role: "assistant", content: [{ type: "text", text: "here is the summary" }] }),
  ];
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}
