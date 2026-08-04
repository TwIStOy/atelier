import { homedir } from "node:os";
import { join } from "node:path";

export const WORKFLOW_SESSION_DIR = join(homedir(), ".agent", "workflow", "session");
