import { glob } from "node:fs/promises";
import { execSync } from "node:child_process";

const root = new URL("..", import.meta.url);

const tests = [];
for await (const entry of glob("extensions/*/test.ts", { root: root.pathname })) {
  tests.push(entry);
}

if (tests.length === 0) {
  console.log("No test files found");
  process.exit(0);
}

let pass = 0;
let fail = 0;

for (const test of tests) {
  const rel = test.replace(root.pathname, "");
  try {
    execSync(`npx tsx ${test}`, { stdio: "pipe", cwd: root.pathname });
    console.log(`  PASS  ${rel}`);
    pass++;
  } catch (e) {
    const out = e.stdout?.toString().trim() ?? "";
    const err = e.stderr?.toString().trim() ?? "";
    console.log(`  FAIL  ${rel}`);
    if (out) console.log(out);
    if (err) console.log(err);
    fail++;
  }
}

console.log(`\n${pass}/${pass + fail} test files passed`);
if (fail > 0) process.exit(1);
