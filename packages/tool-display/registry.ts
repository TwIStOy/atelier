import { ToolDisplayRegistry } from "./tool-call-display.ts";
import { readAdapter } from "./adapters/read.ts";

export const globalToolDisplayRegistry = new ToolDisplayRegistry();
globalToolDisplayRegistry.register("read", readAdapter);
