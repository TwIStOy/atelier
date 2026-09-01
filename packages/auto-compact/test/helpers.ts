import type { SessionEntry, SessionMessageEntry } from "@earendil-works/pi-coding-agent";

export function messageEntry(
  role: "user" | "assistant",
  timestamp: number,
  id = `e-${timestamp}-${role}`,
): SessionMessageEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: new Date(timestamp).toISOString(),
    message: {
      role,
      content: [{ type: "text", text: "hello" }],
      timestamp,
    } as SessionMessageEntry["message"],
  };
}

export function compactionEntry(timestamp: number): SessionEntry {
  return {
    type: "compaction",
    id: `c-${timestamp}`,
    parentId: null,
    timestamp: new Date(timestamp).toISOString(),
    summary: "summary",
    firstKeptEntryId: "kept",
    tokensBefore: 1000,
  } as SessionEntry;
}
