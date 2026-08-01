export function resolveNow(now?: Date | (() => Date)): Date {
  if (now instanceof Date) return now;
  return typeof now === "function" ? now() : new Date();
}
