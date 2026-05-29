import { ToolDisplayRegistry } from "./tool-call-display.ts";
import { readAdapter } from "./adapters/read.ts";
import { writeAdapter } from "./adapters/write.ts";

export const globalToolDisplayRegistry = new ToolDisplayRegistry();
globalToolDisplayRegistry.register("read", readAdapter);
globalToolDisplayRegistry.register("write", writeAdapter);
