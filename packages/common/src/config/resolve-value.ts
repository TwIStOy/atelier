export function getConfigEnvVar(value: string): string | undefined {
  const reference = /^(?:\$([A-Za-z_][A-Za-z0-9_]*)|\{env:([A-Za-z_][A-Za-z0-9_]*)\})$/.exec(value.trim());
  return reference?.[1] ?? reference?.[2];
}

export function resolveConfigValue(
  value: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const name = getConfigEnvVar(value);
  return name === undefined ? value.trim() : (env[name]?.trim() ?? "");
}
