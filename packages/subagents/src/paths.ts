import * as os from "node:os";
import * as path from "node:path";

export const SUBAGENT_SESSION_DIR = path.join(os.homedir(), ".agent", "subagents", "session");
