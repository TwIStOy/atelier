#!/usr/bin/env node
// release.mjs
//
// Cut a unified release across every package in the monorepo.
//
// Given a target version, this script:
//   1. Bumps the "version" field in the root package.json and every
//      packages/*/package.json to the target version.
//   2. Updates changelogs: turns the current "## [Unreleased]" section into a
//      dated "## [<version>] - <date>" section and opens a fresh empty
//      "## [Unreleased]" above it. Creates a CHANGELOG.md for any package that
//      does not have one yet.
//   3. Stages the changed files and creates a single release commit.
//   4. Creates one annotated git tag v<version> on that commit.
//
// It does NOT publish to npm and does NOT push the commit or tag to git. Push
// both manually when you are ready:
//   git push origin master
//   git push origin v<version>
//
// Usage:
//   node scripts/release.mjs <version>            # cut the release
//   node scripts/release.mjs <version> --dry-run  # preview without writing
//   node scripts/release.mjs <version> --force    # skip the clean-tree check
//   node scripts/release.mjs <version> --no-sign  # do not GPG/SSH sign
//
// Flags:
//   --dry-run   Print every planned action without modifying files, committing,
//               or tagging.
//   --force     Run even when the working tree is dirty. By default the script
//               aborts on a dirty tree so it never stomps concurrent work from
//               other sessions.
//   --no-sign   Override tag.gpgSign / commit.gpgSign for this run only, so the
//               release commit and tag are created unsigned. Use on a machine
//               whose signing key or agent is unavailable.
//
// Versioning model: unified. Every package shares one version and ships
// together under a single v<version> tag.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEMVER = /^\d+\.\d+\.\d+$/;

const args = process.argv.slice(2);
let dryRun = false;
let force = false;
let noSign = false;
const positional = [];
for (const a of args) {
  if (a === "--dry-run") dryRun = true;
  else if (a === "--force") force = true;
  else if (a === "--no-sign") noSign = true;
  else positional.push(a);
}

const version = positional[0];
if (!version || !SEMVER.test(version)) {
  console.error(
    "Usage: node scripts/release.mjs <X.Y.Z> [--dry-run] [--force] [--no-sign]",
  );
  process.exit(2);
}

const gitConfig = noSign
  ? ["-c", "tag.gpgSign=false", "-c", "commit.gpgSign=false"]
  : [];

const TAG = `v${version}`;
const today = new Date().toISOString().slice(0, 10);
const VERSION_HEADER = `## [${version}] - ${today}`;

function git(...params) {
  return execFileSync("git", [...gitConfig, ...params], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
}

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

if (git("tag", "-l", TAG) !== "") {
  fail(`tag ${TAG} already exists.`);
}

const status = git("status", "--porcelain");
if (status !== "" && !force) {
  fail(
    `working tree is dirty. Commit or stash your changes first, or rerun with --force.\n${status}`,
  );
}

const pkgNames = readdirSync(join(ROOT, "packages"), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

function readPkg(dir) {
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
}

const rootPkg = readPkg(ROOT);
const toBump = [{ dir: ROOT, name: rootPkg.name, prev: rootPkg.version }];
const changelogModified = [];
const changelogCreated = [];

for (const name of pkgNames) {
  const dir = join(ROOT, "packages", name);
  const pkg = readPkg(dir);
  toBump.push({ dir, name: pkg.name, prev: pkg.version });

  const cl = join(dir, "CHANGELOG.md");
  if (!existsSync(cl)) {
    changelogCreated.push(cl);
    continue;
  }
  const content = readFileSync(cl, "utf8");
  if (content.includes(`## [${version}]`)) {
    fail(`${rel(cl)} already contains a [${version}] section.`);
  }
  changelogModified.push(cl);
}

const rootCl = join(ROOT, "CHANGELOG.md");
if (existsSync(rootCl)) {
  const content = readFileSync(rootCl, "utf8");
  if (!content.includes(`## [${version}]`)) {
    changelogModified.push(rootCl);
  }
}

function rel(abs) {
  return abs.slice(ROOT.length + 1);
}

function bumpPackageJson(dir, ver) {
  const file = join(dir, "package.json");
  const raw = readFileSync(file, "utf8");
  const json = JSON.parse(raw);
  const prev = json.version;
  json.version = ver;
  const trailing = raw.endsWith("\n") ? "\n" : "";
  return { file, prev, out: JSON.stringify(json, null, 2) + trailing };
}

function releaseChangelog(content) {
  const idx = content.indexOf("## [Unreleased]");
  if (idx !== -1) {
    return content.replace(
      "## [Unreleased]",
      `## [Unreleased]\n\n${VERSION_HEADER}`,
    );
  }
  const titleIdx = content.indexOf("# Changelog");
  if (titleIdx !== -1) {
    const lineEnd = content.indexOf("\n", titleIdx);
    const head = content.slice(0, lineEnd + 1);
    const rest = content.slice(lineEnd + 1);
    return `${head}\n## [Unreleased]\n\n${VERSION_HEADER}\n${rest}`;
  }
  return `# Changelog\n\n## [Unreleased]\n\n${VERSION_HEADER}\n${content}`;
}

const NEW_CHANGELOG = `# Changelog

## [Unreleased]

${VERSION_HEADER}

### Added

- Initial release.
`;

const flags = [
  dryRun && "DRY RUN",
  noSign && "NO SIGN",
  force && "FORCE",
].filter(Boolean);
const tagSuffix = flags.length ? ` (${flags.join(", ")})` : "";
console.log(
  `Releasing ${toBump.length - 1} packages${tagSuffix}: ${version} (${today})`,
);

for (const { dir, name, prev } of toBump) {
  const label = dir === ROOT ? "(root)" : name;
  console.log(`  bump  ${label}  ${prev} -> ${version}`);
}

for (const cl of changelogModified) {
  console.log(`  changelog (update)  ${rel(cl)}`);
}
for (const cl of changelogCreated) {
  console.log(`  changelog (create)  ${rel(cl)}`);
}

if (dryRun) {
  console.log("\nDry run: no files written, no commit, no tag.");
  process.exit(0);
}

for (const { dir } of toBump) {
  const { file, out } = bumpPackageJson(dir, version);
  writeFileSync(file, out);
}

for (const cl of changelogModified) {
  const content = readFileSync(cl, "utf8");
  writeFileSync(cl, releaseChangelog(content));
}
for (const cl of changelogCreated) {
  writeFileSync(cl, NEW_CHANGELOG);
}

const paths = [];
for (const { dir } of toBump) paths.push(join(dir, "package.json"));
for (const cl of changelogModified) paths.push(cl);
for (const cl of changelogCreated) paths.push(cl);
const relPaths = paths.map((p) => rel(p));

git("add", "--", ...relPaths);

const subject = `chore(release): ${TAG}`;
const body = `Bump ${toBump.length - 1} packages to ${version} and update changelogs.`;
git("commit", "-m", subject, "-m", body);
const sha = git("rev-parse", "HEAD");

git("tag", "-a", TAG, "-m", `Release ${version}`);

console.log(`\nDone.`);
console.log(`  commit  ${sha.slice(0, 9)}  ${subject}`);
console.log(`  tag     ${TAG}`);
console.log(`\nNot pushed. When ready:`);
console.log(`  git push origin master`);
console.log(`  git push origin ${TAG}`);
