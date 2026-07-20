import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createLogger } from "@htwang-contrib/common";

export const SSH_AUTH_SOCK = "SSH_AUTH_SOCK" as const;

/**
 * Delete `SSH_AUTH_SOCK` from the given environment record.
 *
 * Returns `true` when the variable was present and removed, `false` when it was
 * already absent. Mutates the record in place; never throws.
 */
export function clearSshAuthSock(env: Record<string, string | undefined>): boolean {
  if (!(SSH_AUTH_SOCK in env)) return false;
  delete env[SSH_AUTH_SOCK];
  return true;
}

export default function setup(_pi: ExtensionAPI): void {
  const logger = createLogger("unset-ssh-auth-sock");
  if (clearSshAuthSock(process.env)) {
    logger.info("Removed SSH_AUTH_SOCK from the pi process environment.");
  }
}
