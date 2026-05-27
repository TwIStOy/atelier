import { describe, expect, test } from "vitest";
import { checkBashCommand } from "./bash-check.ts";

const BLOCKED: string[] = [
  "cat /run/agenix/foo",
  "head -5 /run/agenix/foo",
  "tail /run/agenix/foo",
  "echo $(cat /run/agenix/foo)",
  'printf "%s" "$(cat /run/agenix/foo)"',
  "sort /run/agenix/foo",
  "base64 /run/agenix/foo",
  "grep pattern /run/agenix/foo",
  'sed "s/old/new/" /run/agenix/foo',
  "cat /run/agenix/foo | grep something",
  "echo hello && cat /run/agenix/foo",
  ". /run/agenix/foo",
  "source /run/agenix/foo",
];

const ALLOWED: string[] = [
  "API_KEY=$(cat /run/agenix/foo) curl https://example.com",
  "VAR=$(cat /run/agenix/foo)",
  "cat /run/agenix/foo > /tmp/out",
  "cat /run/agenix/foo >> /tmp/out",
  "ls /run/agenix/",
  "stat /run/agenix/foo",
  "cp /run/agenix/foo /tmp/bar",
  "wc -l /run/agenix/foo",
  "md5sum /run/agenix/foo",
  'curl -H "Auth: $(cat /run/agenix/foo)" https://example.com',
  "cat /run/agenix/foo | wc -l > /tmp/count",
  "echo hello world",
  "rm /run/agenix/foo",
  "chmod 600 /run/agenix/foo",
];

describe("checkBashCommand", () => {
  test.each(BLOCKED)("BLOCK: %s", (cmd) => {
    expect(checkBashCommand(cmd)).not.toBeNull();
  });

  test.each(ALLOWED)("ALLOW: %s", (cmd) => {
    expect(checkBashCommand(cmd)).toBeNull();
  });
});
