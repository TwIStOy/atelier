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
  parseExtraMounts,
  type VmHandle,
} from "./vm-ops.ts";

const CONFIG_ID = "gondolin-sandbox";
const EXTENSION_LABEL = "Gondolin Sandbox";
const GUEST_WORKSPACE = "/workspace";

interface SandboxConfig {
  enabled: boolean;
  allowedHosts: string;
  extraMounts: string;
  image: string;
  memory: string;
  cpus: number;
}

const DEFAULT_CONFIG: SandboxConfig = {
  enabled: false,
  allowedHosts: "",
  extraMounts: "",
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
      key: "extraMounts",
      type: "string",
      label: "Extra Mounts",
      value: () => loadConfig().extraMounts,
      placeholder: "/tmp:/tmp,/nix/store:/nix/store:ro",
      description:
        'Comma-separated extra host mounts as "hostPath:guestPath[:ro|:rw]". Paths outside the workspace and these mounts are rejected. Guest path must match the host path for bash commands referencing it to work.',
      extensionLabel: EXTENSION_LABEL,
      order: 15,
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

  async function ensureVm(ctx?: ExtensionContext): Promise<VmHandle | null> {
    if (!loadConfig().enabled) return null;
    if (handle) return handle;
    if (starting) return starting;

    starting = (async () => {
      const config = loadConfig();
      setStatus(ctx, `${EXTENSION_LABEL}: starting (mount ${GUEST_WORKSPACE})`);

      const created = await createSandboxVm(
        localCwd,
        {
          allowedHosts: parseAllowedHosts(config.allowedHosts),
          extraMounts: parseExtraMounts(config.extraMounts),
        },
        {
          sandbox: { imagePath: config.image },
          memory: config.memory,
          cpus: config.cpus,
        },
      );

      handle = created;
      setStatus(ctx, `${EXTENSION_LABEL}: running (${localCwd} -> ${GUEST_WORKSPACE})`);
      notify(ctx, `Gondolin VM ready. Host ${localCwd} mounted at ${GUEST_WORKSPACE}`, "info");
      for (const warning of created.warnings) {
        notify(ctx, `${EXTENSION_LABEL}: ${warning}`, "warning");
      }
      return created;
    })();

    try {
      return await starting;
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
    annotations: { readOnlyHint: true },
    async execute(id, params, signal, onUpdate, ctx) {
      const h = await ensureVm(ctx);
      if (!h) return localRead.execute(id, params, signal, onUpdate);
      const tool = createReadTool(localCwd, {
        operations: createGondolinReadOps(h.vm, h.mounts),
      });
      return tool.execute(id, params, signal, onUpdate);
    },
  });

  pi.registerTool({
    ...localWrite,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    async execute(id, params, signal, onUpdate, ctx) {
      const h = await ensureVm(ctx);
      if (!h) return localWrite.execute(id, params, signal, onUpdate);
      const tool = createWriteTool(localCwd, {
        operations: createGondolinWriteOps(h.vm, h.mounts),
      });
      return tool.execute(id, params, signal, onUpdate);
    },
  });

  pi.registerTool({
    ...localEdit,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    async execute(id, params, signal, onUpdate, ctx) {
      const h = await ensureVm(ctx);
      if (!h) return localEdit.execute(id, params, signal, onUpdate);
      const tool = createEditTool(localCwd, {
        operations: createGondolinEditOps(h.vm, h.mounts),
      });
      return tool.execute(id, params, signal, onUpdate);
    },
  });

  pi.registerTool({
    ...localBash,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    async execute(id, params, signal, onUpdate, ctx) {
      const h = await ensureVm(ctx);
      if (!h) return localBash.execute(id, params, signal, onUpdate);
      const tool = createBashTool(localCwd, {
        operations: createGondolinBashOps(h.vm, h.mounts),
      });
      return tool.execute(id, params, signal, onUpdate);
    },
  });

  pi.registerTool({
    ...localGrep,
    annotations: { readOnlyHint: true },
    async execute(id, params, signal, onUpdate, ctx) {
      const h = await ensureVm(ctx);
      if (!h) return localGrep.execute(id, params, signal, onUpdate);
      const tool = createGrepTool(localCwd, {
        operations: createGondolinGrepOps(h.vm, h.mounts),
      });
      return tool.execute(id, params, signal, onUpdate);
    },
  });

  pi.registerTool({
    ...localFind,
    annotations: { readOnlyHint: true },
    async execute(id, params, signal, onUpdate, ctx) {
      const h = await ensureVm(ctx);
      if (!h) return localFind.execute(id, params, signal, onUpdate);
      const tool = createFindTool(localCwd, {
        operations: createGondolinFindOps(h.vm, h.mounts),
      });
      return tool.execute(id, params, signal, onUpdate);
    },
  });

  pi.registerTool({
    ...localLs,
    annotations: { readOnlyHint: true },
    async execute(id, params, signal, onUpdate, ctx) {
      const h = await ensureVm(ctx);
      if (!h) return localLs.execute(id, params, signal, onUpdate);
      const tool = createLsTool(localCwd, {
        operations: createGondolinLsOps(h.vm, h.mounts),
      });
      return tool.execute(id, params, signal, onUpdate);
    },
  });

  pi.on("user_bash", async (_event, _ctx) => {
    if (!handle) return;
    return { operations: createGondolinBashOps(handle.vm, handle.mounts) };
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const h = await ensureVm(ctx);
    if (!h) return;
    let modified = event.systemPrompt.replace(
      `Current working directory: ${localCwd}`,
      `Current working directory: ${GUEST_WORKSPACE} (Gondolin VM, mounted from host: ${localCwd})`,
    );
    if (h.mounts.length > 1) {
      const extras = h.mounts
        .slice(1)
        .map((m) => `${m.guestRoot} (${m.readOnly ? "ro" : "rw"}, host ${m.hostRoot})`)
        .join(", ");
      modified += `\nGondolin sandbox extra mounts: ${extras}`;
    }
    return { systemPrompt: modified };
  });
}
