import { ToolDisplayRegistry } from "./tool-call-display.ts";
import { askUserQuestionAdapter } from "./adapters/ask-user-question.ts";
import { bashAdapter } from "./adapters/bash.ts";
import { editAdapter } from "./adapters/edit.ts";
import { globAdapter } from "./adapters/glob.ts";
import {
  createGoalAdapter,
  getGoalAdapter,
  updateGoalAdapter,
} from "./adapters/goal.ts";
import { grepAdapter } from "./adapters/grep.ts";
import {
  journalReadAdapter,
  journalSearchAdapter,
  journalWriteAdapter,
} from "./adapters/journal.ts";
import { lsAdapter } from "./adapters/ls.ts";
import {
  memoryAliasAdapter,
  memoryCreateAdapter,
  memoryDeleteAdapter,
  memoryDomainsAdapter,
  memoryHistoryAdapter,
  memoryListAdapter,
  memoryReadAdapter,
  memorySearchAdapter,
  memoryTriggersAdapter,
  memoryUpdateAdapter,
} from "./adapters/memory.ts";
import { readAdapter } from "./adapters/read.ts";
import { subagentAdapter } from "./adapters/subagent.ts";
import { subagentStatusAdapter } from "./adapters/subagent-status.ts";
import { writeAdapter } from "./adapters/write.ts";

export const globalToolDisplayRegistry = new ToolDisplayRegistry();
globalToolDisplayRegistry.register("ask_user_question", askUserQuestionAdapter);
globalToolDisplayRegistry.register("read", readAdapter);
globalToolDisplayRegistry.register("grep", grepAdapter);
globalToolDisplayRegistry.register("glob", globAdapter);
globalToolDisplayRegistry.register("ls", lsAdapter);
globalToolDisplayRegistry.register("write", writeAdapter);
globalToolDisplayRegistry.register("edit", editAdapter);
globalToolDisplayRegistry.register("bash", bashAdapter);
globalToolDisplayRegistry.register("subagent", subagentAdapter);
globalToolDisplayRegistry.register("subagent_status", subagentStatusAdapter);
globalToolDisplayRegistry.register("create_goal", createGoalAdapter);
globalToolDisplayRegistry.register("update_goal", updateGoalAdapter);
globalToolDisplayRegistry.register("get_goal", getGoalAdapter);
globalToolDisplayRegistry.register("memory-create", memoryCreateAdapter);
globalToolDisplayRegistry.register("memory-read", memoryReadAdapter);
globalToolDisplayRegistry.register("memory-update", memoryUpdateAdapter);
globalToolDisplayRegistry.register("memory-delete", memoryDeleteAdapter);
globalToolDisplayRegistry.register("memory-search", memorySearchAdapter);
globalToolDisplayRegistry.register("memory-list", memoryListAdapter);
globalToolDisplayRegistry.register("memory-alias", memoryAliasAdapter);
globalToolDisplayRegistry.register("memory-triggers", memoryTriggersAdapter);
globalToolDisplayRegistry.register("memory-history", memoryHistoryAdapter);
globalToolDisplayRegistry.register("memory-domains", memoryDomainsAdapter);
globalToolDisplayRegistry.register("journal-write", journalWriteAdapter);
globalToolDisplayRegistry.register("journal-read", journalReadAdapter);
globalToolDisplayRegistry.register("journal-search", journalSearchAdapter);
