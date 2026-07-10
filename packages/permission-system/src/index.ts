import type { ExtensionAPI, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { createLogger } from "@htwang-contrib/common";
import { loadAndMergeConfigs } from "./config-loader.ts";
import { runGatePipeline } from "./handlers/gates/tool-call-gate-pipeline.ts";
import { PathNormalizer } from "./path-normalizer.ts";
import { PermissionResolver } from "./permission-resolver.ts";
import { normalizeFlatConfig } from "./rule.ts";
import type { ScopedPermissionResolver, ToolCallContext } from "./types.ts";

const logger = createLogger("@htwang-contrib/permission-system");

interface SessionState {
  resolver: ScopedPermissionResolver;
  normalizer: PathNormalizer;
}

let state: SessionState | null = null;

export default function permissionSystemExtension(pi: ExtensionAPI): void {
  logger.info("extension loaded");

  pi.on("session_start", (_event, ctx) => {
    const cwd = ctx.cwd;
    try {
      const result = loadAndMergeConfigs(getAgentDir(), cwd);
      for (const issue of result.issues) logger.warn(issue);
      const resolver = new PermissionResolver(normalizeFlatConfig(result.permission));
      const normalizer = new PathNormalizer(process.platform, cwd);
      state = { resolver, normalizer };
      logger.info(`session started (cwd=${cwd}, issues=${result.issues.length})`);
    } catch (error) {
      logger.error(`failed to load config: ${String(error)}`);
      state = null;
    }
  });

  pi.on("tool_call", async (event: ToolCallEvent, ctx) => {
    if (!state) return;
    const tcc: ToolCallContext = {
      toolName: event.toolName,
      agentName: null,
      input: event.input,
      cwd: ctx.cwd,
    };
    try {
      return await runGatePipeline(tcc, {
        resolver: state.resolver,
        normalizer: state.normalizer,
        ui: ctx.ui,
        hasUI: ctx.hasUI,
      });
    } catch (error) {
      logger.error(`pipeline threw: ${String(error)}`);
      return { block: true, reason: "permission-system gate pipeline failed (fail-closed)" };
    }
  });
}
