import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const MEMORY_SETTINGS_KEY = "memory";

type MemorySettings = {
  enabled?: boolean;
  namespace?: string;
};

const NAMESPACE_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function sanitizeNamespace(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  return NAMESPACE_PATTERN.test(trimmed) ? trimmed : "";
}

let sessionNamespace = "";

export function setSessionNamespace(namespace: string): void {
  sessionNamespace = namespace;
}

export function getSessionNamespace(): string {
  return sessionNamespace;
}

export function isDisabledByEnv(): boolean {
  const v = process.env.DOTPI_MEMORY?.trim().toLowerCase();
  return v === "0" || v === "false" || v === "off";
}

function asSettingsObject(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
}

function readFromProjectSettings(raw: unknown): MemorySettings | undefined {
  const root = asSettingsObject(raw);
  if (!root) return undefined;
  const block = asSettingsObject(root[MEMORY_SETTINGS_KEY]);
  if (!block) return undefined;
  return block as MemorySettings;
}

function projectSettings(ctx?: ExtensionContext): unknown {
  const settings = (ctx as { settingsManager?: { getProjectSettings?: () => unknown } })?.settingsManager;
  return settings?.getProjectSettings?.();
}

function memorySettings(ctx?: ExtensionContext): MemorySettings | undefined {
  return readFromProjectSettings(projectSettings(ctx));
}

export function isMemoryEnabled(ctx?: ExtensionContext): boolean {
  if (isDisabledByEnv()) return false;
  return memorySettings(ctx)?.enabled !== false;
}

export function getNamespace(ctx?: ExtensionContext): string {
  return sanitizeNamespace(memorySettings(ctx)?.namespace ?? "");
}
