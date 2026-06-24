const REDACTED = "<redacted>";

interface SecretPattern {
  re: RegExp;
  replacement: string;
}

const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    re: /(Authorization:\s*Bearer\s+)(\S+)/gi,
    replacement: `$1${REDACTED}`,
  },
  {
    re: /(\bBearer\s+)(\S+)/gi,
    replacement: `$1${REDACTED}`,
  },
  {
    re: /\b([A-Z][A-Z0-9_]*API_KEY\s*=\s*)(["']?)([^\s,;"']+)\2/gi,
    replacement: `$1$2${REDACTED}$2`,
  },
];

export function redactSecrets(value: unknown, additionalSecrets: ReadonlyArray<unknown> = []): string {
  let text = value == null ? "" : String(value);
  for (const { re, replacement } of SECRET_PATTERNS) {
    text = text.replace(re, replacement);
  }
  for (const secret of additionalSecrets) {
    const literal = String(secret ?? "").trim();
    if (!literal) continue;
    if (text.includes(literal)) {
      text = text.split(literal).join(REDACTED);
    }
  }
  return text;
}

function extractMessage(error: unknown): string {
  if (error == null) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && "message" in error) {
    const msg = (error as { message: unknown }).message;
    return msg == null ? "" : String(msg);
  }
  return String(error);
}

export function safeError(error: unknown, additionalSecrets: ReadonlyArray<unknown> = []): string {
  return redactSecrets(extractMessage(error), additionalSecrets);
}
