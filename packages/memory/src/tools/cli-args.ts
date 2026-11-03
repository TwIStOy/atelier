export function pushDefined(cliArgs: string[], flag: string, value: unknown): void {
  if (value !== undefined) cliArgs.push(flag, String(value));
}

export function pushTruthy(cliArgs: string[], flag: string, value: unknown): void {
  if (value) cliArgs.push(flag, value as string);
}

export function pushCsv(cliArgs: string[], flag: string, value: unknown): void {
  const items = value as string[] | undefined;
  if (items?.length) cliArgs.push(flag, items.join(","));
}
