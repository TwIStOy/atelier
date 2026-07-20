import { describe, expect, test } from "vitest";
import { clearSshAuthSock } from "../src/index.ts";

describe("clearSshAuthSock", () => {
  test("removes an existing SSH_AUTH_SOCK", () => {
    const env: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      SSH_AUTH_SOCK: "/tmp/ssh-agent.sock",
      HOME: "/home/user",
    };

    expect(clearSshAuthSock(env)).toBe(true);
    expect("SSH_AUTH_SOCK" in env).toBe(false);
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/user");
  });

  test("leaves other variables untouched and reports nothing to do", () => {
    const env: Record<string, string | undefined> = { PATH: "/usr/bin" };

    expect(clearSshAuthSock(env)).toBe(false);
    expect(env).toEqual({ PATH: "/usr/bin" });
  });

  test("is idempotent", () => {
    const env: Record<string, string | undefined> = { SSH_AUTH_SOCK: "/tmp/agent.sock" };

    expect(clearSshAuthSock(env)).toBe(true);
    expect(clearSshAuthSock(env)).toBe(false);
  });
});
