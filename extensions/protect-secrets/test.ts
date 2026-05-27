import { checkBashCommand } from "./bash-check.ts";

const cases: [string, boolean][] = [
  ["cat /run/agenix/foo", true],
  ["head -5 /run/agenix/foo", true],
  ["tail /run/agenix/foo", true],
  ["echo $(cat /run/agenix/foo)", true],
  ['printf "%s" "$(cat /run/agenix/foo)"', true],
  ["sort /run/agenix/foo", true],
  ["base64 /run/agenix/foo", true],
  ["grep pattern /run/agenix/foo", true],
  ['sed "s/old/new/" /run/agenix/foo', true],
  ["cat /run/agenix/foo | grep something", true],
  ["echo hello && cat /run/agenix/foo", true],
  [". /run/agenix/foo", true],
  ["source /run/agenix/foo", true],

  ["API_KEY=$(cat /run/agenix/foo) curl https://example.com", false],
  ["VAR=$(cat /run/agenix/foo)", false],
  ["cat /run/agenix/foo > /tmp/out", false],
  ["cat /run/agenix/foo >> /tmp/out", false],
  ["ls /run/agenix/", false],
  ["stat /run/agenix/foo", false],
  ["cp /run/agenix/foo /tmp/bar", false],
  ["wc -l /run/agenix/foo", false],
  ["md5sum /run/agenix/foo", false],
  ['curl -H "Auth: $(cat /run/agenix/foo)" https://example.com', false],
  ["cat /run/agenix/foo | wc -l > /tmp/count", false],
  ["echo hello world", false],
  ["rm /run/agenix/foo", false],
  ["chmod 600 /run/agenix/foo", false],
];

let pass = 0;
let fail = 0;
for (const [cmd, shouldBlock] of cases) {
  const result = checkBashCommand(cmd);
  const blocked = result !== null;
  const ok = blocked === shouldBlock;
  if (!ok) {
    console.log(
      `FAIL: "${cmd}" — expected ${shouldBlock ? "BLOCK" : "ALLOW"}, got ${blocked ? "BLOCK" : "ALLOW"}${result ? ` (${result})` : ""}`,
    );
    fail++;
  } else {
    pass++;
  }
}
console.log(`\n${pass}/${pass + fail} tests passed`);
if (fail > 0) process.exit(1);
