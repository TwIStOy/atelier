import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export function contentHash(content: string | Buffer): string {
  const buf = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  return createHash("sha256").update(buf).digest("hex");
}

export function atomicWriteFile(filePath: string, content: string | Buffer): void {
  ensureParentDir(filePath);
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}

export function appendJsonl(filePath: string, record: unknown): void {
  ensureParentDir(filePath);
  const line = JSON.stringify(record);
  fs.appendFileSync(filePath, `${line}\n`, "utf8");
}

function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function formatPacketDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function allocateSourcePacket(sourcesDir: string, date: Date): string {
  fs.mkdirSync(sourcesDir, { recursive: true });
  const prefix = `SRC-${formatPacketDate(date)}-`;
  for (let seq = 1; ; seq++) {
    const candidate = path.join(sourcesDir, `${prefix}${String(seq).padStart(3, "0")}`);
    try {
      fs.mkdirSync(candidate);
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
}
