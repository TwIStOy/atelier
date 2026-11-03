import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { runHat } from "./cli-runner.js";
import { getNamespace, isDisabledByEnv, isMemoryEnabled } from "./settings.js";

function stringField(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function domainName(o: Record<string, unknown>): string {
  return stringField(o.name) || stringField(o.domain) || stringField(o.id) || "?";
}

function domainCount(o: Record<string, unknown>): number | undefined {
  return typeof o.count === "number" ? o.count : typeof o.node_count === "number" ? o.node_count : undefined;
}

function formatDomainRecord(o: Record<string, unknown>): string {
  const name = domainName(o);
  const count = domainCount(o);
  return count !== undefined ? `  - ${name} (${count} nodes)` : `  - ${name}`;
}

function formatDomainEntry(entry: unknown): string {
  if (typeof entry === "string") return `  - ${entry}`;
  if (!entry || typeof entry !== "object") return `  - ${String(entry)}`;
  return formatDomainRecord(entry as Record<string, unknown>);
}

function domainsError(result: unknown): string | undefined {
  if (result && typeof result === "object" && "error" in result) {
    const err = (result as { error?: unknown }).error;
    return `Domains: error — ${String(err)}`;
  }
  return undefined;
}

function recordOrUndefined(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
}

function firstArray(...values: unknown[]): unknown[] {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function extractDomainsList(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  const record = recordOrUndefined(result);
  if (!record) return [];
  return firstArray(record.domains, record.data);
}

function domainsPreview(result: unknown): string {
  if (typeof result === "string") return result.slice(0, 200);
  return JSON.stringify(result)?.slice(0, 200) ?? "empty";
}

function formatDomainsResult(result: unknown): string {
  const error = domainsError(result);
  if (error !== undefined) return error;

  const list = extractDomainsList(result);
  if (list.length === 0) {
    return `Domains: no list in CLI response (${domainsPreview(result)})`;
  }

  return [`Domains: ${list.length} registered`, ...list.map(formatDomainEntry)].join("\n");
}

function memoryDisabledReason(ctx: ExtensionCommandContext): string | undefined {
  if (isDisabledByEnv()) {
    return "memory: disabled for this process (DOTPI_MEMORY=0 / false / off).";
  }

  if (!isMemoryEnabled(ctx)) {
    return "memory: disabled in project settings (memory.enabled: false).";
  }

  return undefined;
}

function namespaceLine(namespace: string): string {
  return namespace ? `Namespace: ${namespace} (hat --namespace)` : "Namespace: (default — shared store)";
}

async function domainsLine(namespace: string): Promise<string> {
  try {
    const domains = await runHat(["memory", "domains"], {
      namespace,
    });
    return formatDomainsResult(domains);
  } catch (e) {
    return `Domains: ${String(e)}`;
  }
}

export async function buildMemoryStatusReport(ctx: ExtensionCommandContext): Promise<string> {
  const disabled = memoryDisabledReason(ctx);
  if (disabled !== undefined) return disabled;

  const lines: string[] = ["memory: enabled"];

  const namespace = getNamespace(ctx);
  lines.push(namespaceLine(namespace));

  lines.push("CLI: hat");

  lines.push(await domainsLine(namespace));

  return lines.join("\n");
}
