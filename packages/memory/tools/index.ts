import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { memoryRead } from "./memory-read.js";
import { memoryCreate } from "./memory-create.js";
import { memoryUpdate } from "./memory-update.js";
import { memoryDelete } from "./memory-delete.js";
import { memorySearch } from "./memory-search.js";
import { memoryList } from "./memory-list.js";
import { memoryAlias } from "./memory-alias.js";
import { memoryTriggers } from "./memory-triggers.js";
import { memoryHistory } from "./memory-history.js";
import { memoryDomains } from "./memory-domains.js";
import { journalWrite } from "./journal-write.js";
import { journalRead } from "./journal-read.js";
import { journalSearch } from "./journal-search.js";

const memoryTools = [
  memoryRead,
  memoryCreate,
  memoryUpdate,
  memoryDelete,
  memorySearch,
  memoryList,
  memoryAlias,
  memoryTriggers,
  memoryHistory,
  memoryDomains,
];

export function registerMemoryTools(pi: ExtensionAPI): void {
  for (const tool of memoryTools) {
    pi.registerTool(tool);
  }
}

export function registerJournalTools(
  pi: ExtensionAPI,
  getCwd: () => string,
): void {
  pi.registerTool(journalWrite(getCwd));
  pi.registerTool(journalRead);
  pi.registerTool(journalSearch);
}
