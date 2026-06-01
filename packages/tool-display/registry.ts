import { ToolDisplayRegistry } from "./tool-call-display.ts";
import { bashAdapter } from "./adapters/bash.ts";
import { editAdapter } from "./adapters/edit.ts";
import { readAdapter } from "./adapters/read.ts";
import { subagentAdapter } from "./adapters/subagent.ts";
import { writeAdapter } from "./adapters/write.ts";

export const globalToolDisplayRegistry = new ToolDisplayRegistry();
globalToolDisplayRegistry.register("read", readAdapter);
globalToolDisplayRegistry.register("write", writeAdapter);
globalToolDisplayRegistry.register("edit", editAdapter);
globalToolDisplayRegistry.register("bash", bashAdapter);
globalToolDisplayRegistry.register("subagent", subagentAdapter);
