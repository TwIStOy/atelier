import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const MEMORY_SETTINGS_KEY = "memory";

export type MemorySettings = {
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

function readFromProjectSettings(raw: unknown): MemorySettings | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const block = (raw as Record<string, unknown>)[MEMORY_SETTINGS_KEY];
  if (!block || typeof block !== "object") return undefined;
  return block as MemorySettings;
}

export function isMemoryEnabled(ctx?: ExtensionContext): boolean {
  if (isDisabledByEnv()) return false;
  const settings = (ctx as { settingsManager?: { getProjectSettings?: () => unknown } })?.settingsManager;
  const project = settings?.getProjectSettings?.();
  const cfg = readFromProjectSettings(project);
  if (cfg?.enabled === false) return false;
  return true;
}

export function getNamespace(ctx?: ExtensionContext): string {
  const settings = (ctx as { settingsManager?: { getProjectSettings?: () => unknown } })?.settingsManager;
  const project = settings?.getProjectSettings?.();
  const cfg = readFromProjectSettings(project);
  return sanitizeNamespace(cfg?.namespace ?? "");
}
