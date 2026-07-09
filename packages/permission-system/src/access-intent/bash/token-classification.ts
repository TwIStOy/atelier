import type { PathRuleTokenMatcher } from "../../types.ts";

export interface RuleCandidateOptions {
  readonly windowsSeparators?: boolean;
}

export function classifyTokenAsPathCandidate(token: string): string | null {
  if (rejectNonPathToken(token)) return null;

  if (token.startsWith("/")) return token;
  if (token.startsWith("~/")) return token;
  if (token.includes("..")) return token;
  if (WINDOWS_DRIVE_PATH_PATTERN.test(token)) return token;

  return null;
}

export function classifyTokenAsRuleCandidate(token: string, options?: RuleCandidateOptions): string | null {
  if (rejectNonPathToken(token)) return null;

  if (token.startsWith(".")) return token;
  if (token.includes("/")) return token;
  if (token.includes("..")) return token;
  if (WINDOWS_DRIVE_PATH_PATTERN.test(token)) return token;
  if (options?.windowsSeparators && token.includes("\\")) return token;

  return null;
}

export function classifyPromotedRuleCandidate(token: string, isPromotable: PathRuleTokenMatcher): string | null {
  if (rejectNonPathToken(token)) return null;
  return isPromotable(token) ? token : null;
}

const WINDOWS_DRIVE_PATH_PATTERN = /^[a-zA-Z]:[/\\]/;

const URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

const REGEX_METACHAR_PATTERN = /\.\*|\.\+|\\\||\\\(|\\\)|\[.*?\]|\^\//;

function rejectNonPathToken(token: string): boolean {
  if (!token) return true;
  if (token.startsWith("-")) return true;

  const eqIndex = token.indexOf("=");
  const slashIndex = token.indexOf("/");
  if (eqIndex !== -1 && (slashIndex === -1 || eqIndex < slashIndex)) return true;

  if (URL_PATTERN.test(token)) return true;

  if (token.startsWith("@") && !token.startsWith("@/")) return true;

  if (/^\/+$/.test(token)) return true;

  if (REGEX_METACHAR_PATTERN.test(token)) return true;

  return false;
}
