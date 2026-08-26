import type { VM } from "@earendil-works/gondolin";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-coding-agent";
import {
  type ExtensionConfigSchema,
  isExtensionDisabled,
  isStaleCtxError,
  readConfig,
  registerConfigItems,
} from "@htwang-contrib/common";

import {
  createGondolinBashOps,
  createGondolinEditOps,
  createGondolinFindOps,
  createGondolinGrepOps,
  createGondolinLsOps,
  createGondolinReadOps,
  createGondolinWriteOps,
  createSandboxVm,
  type VmHandle,
} from "./vm-ops.ts";

const CONFIG_ID = "gondolin-sandbox";
const EXTENSION_LABEL = "Gondolin Sandbox";
const GUEST_WORKSPACE = "/workspace";

interface SandboxConfig {
  enabled: boolean;
  allowedHosts: string;
  image: string;
  memory: string;
  cpus: number;
}

const DEFAULT_CONFIG: SandboxConfig = {
  enabled: false,
  allowedHosts: "",
  image: "alpine-tools:latest",
  memory: "1G",
  cpus: 2,
};

const CONFIG_SCHEMA: ExtensionConfigSchema<SandboxConfig> = {
  defaults: DEFAULT_CONFIG,
};

function loadConfig(): SandboxConfig {
  return readConfig(CONFIG_ID, CONFIG_SCHEMA);
}

function parseAllowedHosts(raw: string): string[] {
  return raw
    .split(",")
    .map((h) => h.trim())
    .filter((h) => h.length > 0);
}

function registerConfig(): void {
  registerConfigItems(CONFIG_ID, [
    {
      key: "enabled",
      type: "boolean",
      label: "Enabled",
      value: () => loadConfig().enabled,
      description:
        "Run read/write/edit/bash/grep/find/ls inside a Gondolin micro-VM. The host cwd is mounted at /workspace. Off = pi behaves normally.",
      extensionLabel: EXTENSION_LABEL,
      order: 0,
    },
    {
      key: "allowedHosts",
      type: "string",
      label: "Allowed Hosts",
      value: () => loadConfig().allowedHosts,
      placeholder: "api.github.com,registry.npmjs.org",
      description: "Comma-separated HTTP egress allowlist. Empty = open egress (the Gondolin default).",
      extensionLabel: EXTENSION_LABEL,
      order: 10,
    },
    {
      key: "image",
      type: "string",
      label: "Image",
      value: () => loadConfig().image,
      placeholder: "alpine-tools:latest",
      description:
        "Guest image selector resolved via the image registry. Default alpine-tools:latest adds fd and ripgrep on top of alpine-base (build it with the config under this package's image/ directory).",
      extensionLabel: EXTENSION_LABEL,
      order: 20,
    },
    {
      key: "memory",
      type: "string",
      label: "Memory",
      value: () => loadConfig().memory,
      description: "VM memory size forwarded to QEMU.",
      extensionLabel: EXTENSION_LABEL,
      order: 30,
    },
    {
      key: "cpus",
      type: "number",
      label: "CPUs",
      value: () => loadConfig().cpus,
      min: 1,
      max: 16,
      description: "VM CPU count.",
      extensionLabel: EXTENSION_LABEL,
      order: 40,
    },
  ]);
}

function setStatus(ctx: ExtensionContext | undefined, text: string): void {
  try {
    ctx?.ui.setStatus("gondolin-sandbox", text);
  } catch {
    // ctx may be stale during shutdown; ignore.
  }
}

function notify(ctx: ExtensionContext | undefined, message: string, type: "info" | "warning" | "error" = "info"): void {
  try {
    ctx?.ui.notify(message, type);
  } catch {
    // ignore stale ctx
  }
}

export default function (pi: ExtensionAPI) {
  if (isExtensionDisabled("gondolin-sandbox")) return;
  registerConfig();

  const localCwd = process.cwd();

  const localRead = createReadTool(localCwd);
  const localWrite = createWriteTool(localCwd);
  const localEdit = createEditTool(localCwd);
  const localBash = createBashTool(localCwd);
  const localGrep = createGrepTool(localCwd);
  const localFind = createFindTool(localCwd);
  const localLs = createLsTool(localCwd);

  let handle: VmHandle | null = null;
  let starting: Promise<VmHandle> | null = null;

  async function ensureVm(ctx?: ExtensionContext): Promise<VM | null> {
    if (!loadConfig().enabled) return null;
    if (handle) return handle.vm;
    if (starting) return (await starting).vm;

    starting = (async () => {
      const config = loadConfig();
      setStatus(ctx, `${EXTENSION_LABEL}: starting (mount ${GUEST_WORKSPACE})`);

      const created = await createSandboxVm(
        localCwd,
        { allowedHosts: parseAllowedHosts(config.allowedHosts) },
        {
          sandbox: { imagePath: config.image },
          memory: config.memory,
          cpus: config.cpus,
        },
      );

      handle = created;
      setStatus(ctx, `${EXTENSION_LABEL}: running (${localCwd} -> ${GUEST_WORKSPACE})`);
      notify(ctx, `Gondolin VM ready. Host ${localCwd} mounted at ${GUEST_WORKSPACE}`, "info");
      return created;
    })();

    try {
      return (await starting).vm;
    } catch (err) {
      if (isStaleCtxError(err)) return null;
      starting = null;
      notify(ctx, `${EXTENSION_LABEL}: failed to start VM: ${String(err)}`, "error");
      throw err;
    } finally {
      starting = null;
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    try {
      await ensureVm(ctx);
    } catch (err) {
      if (isStaleCtxError(err)) return;
      // Error already surfaced via notify; swallow to avoid killing the session.
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (!handle) return;
    setStatus(ctx, `${EXTENSION_LABEL}: stopping`);
    try {
      await handle.vm.close();
    } catch {
      // best-effort cleanup during shutdown
    } finally {
      handle = null;
      starting = null;
    }
  });

  pi.registerTool({
    ...localRead,
    async execute(id, params, signal, onUpdate, ctx) {
      const vm = await ensureVm(ctx);
      if (!vm) return localRead.execute(id, params, signal, onUpdate);
      const tool = createReadTool(localCwd, {
        operations: createGondolinReadOps(vm, localCwd),
      });
      return tool.execute(id, params, signal, onUpdate);
    },
  });

  pi.registerTool({
    ...localWrite,
    async execute(id, params, signal, onUpdate, ctx) {
      const vm = await ensureVm(ctx);
      if (!vm) return localWrite.execute(id, params, signal, onUpdate);
      const tool = createWriteTool(localCwd, {
        operations: createGondolinWriteOps(vm, localCwd),
      });
      return tool.execute(id, params, signal, onUpdate);
    },
  });

  pi.registerTool({
    ...localEdit,
    async execute(id, params, signal, onUpdate, ctx) {
      const vm = await ensureVm(ctx);
      if (!vm) return localEdit.execute(id, params, signal, onUpdate);
      const tool = createEditTool(localCwd, {
        operations: createGondolinEditOps(vm, localCwd),
      });
      return tool.execute(id, params, signal, onUpdate);
    },
  });

  pi.registerTool({
    ...localBash,
    async execute(id, params, signal, onUpdate, ctx) {
      const vm = await ensureVm(ctx);
      if (!vm) return localBash.execute(id, params, signal, onUpdate);
      const tool = createBashTool(localCwd, {
        operations: createGondolinBashOps(vm, localCwd),
      });
      return tool.execute(id, params, signal, onUpdate);
    },
  });

  pi.registerTool({
    ...localGrep,
    async execute(id, params, signal, onUpdate, ctx) {
      const vm = await ensureVm(ctx);
      if (!vm) return localGrep.execute(id, params, signal, onUpdate);
      const tool = createGrepTool(localCwd, {
        operations: createGondolinGrepOps(vm, localCwd),
      });
      return tool.execute(id, params, signal, onUpdate);
    },
  });

  pi.registerTool({
    ...localFind,
    async execute(id, params, signal, onUpdate, ctx) {
      const vm = await ensureVm(ctx);
      if (!vm) return localFind.execute(id, params, signal, onUpdate);
      const tool = createFindTool(localCwd, {
        operations: createGondolinFindOps(vm, localCwd),
      });
      return tool.execute(id, params, signal, onUpdate);
    },
  });

  pi.registerTool({
    ...localLs,
    async execute(id, params, signal, onUpdate, ctx) {
      const vm = await ensureVm(ctx);
      if (!vm) return localLs.execute(id, params, signal, onUpdate);
      const tool = createLsTool(localCwd, {
        operations: createGondolinLsOps(vm, localCwd),
      });
      return tool.execute(id, params, signal, onUpdate);
    },
  });

  pi.on("user_bash", async (_event, _ctx) => {
    if (!handle) return;
    return { operations: createGondolinBashOps(handle.vm, localCwd) };
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const vm = await ensureVm(ctx);
    if (!vm) return;
    const modified = event.systemPrompt.replace(
      `Current working directory: ${localCwd}`,
      `Current working directory: ${GUEST_WORKSPACE} (Gondolin VM, mounted from host: ${localCwd})`,
    );
    return { systemPrompt: modified };
  });
}
