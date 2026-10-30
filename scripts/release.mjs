#!/usr/bin/env node
// release.mjs
//
// Cut a unified release across every package in the monorepo.
//
// Given a target version, this script:
//   1. Bumps the "version" field in the root package.json and every
//      packages/*/package.json and extensions/*/package.json to the target version.
//   2. Updates changelogs: turns the current "## [Unreleased]" section into a
//      dated "## [<version>] - <date>" section and opens a fresh empty
//      "## [Unreleased]" above it. Packages whose "## [Unreleased]" section is
//      empty are left untouched, so no empty version section is ever added.
//      Creates a CHANGELOG.md for any package that does not have one yet.
//   3. Stages the changed files and creates a single release commit.
//   4. Creates one annotated git tag v<version> on that commit.
//
// It does NOT publish to npm and does NOT push the commit or tag to git. Push
// both manually when you are ready:
//   git push origin master
//   git push origin v<version>
//
// Usage:
//   node scripts/release.mjs --major               # 1.2.3 -> 2.0.0
//   node scripts/release.mjs --minor               # 1.2.3 -> 1.3.0
//   node scripts/release.mjs --patch               # 1.2.3 -> 1.2.4
//   node scripts/release.mjs <version>             # cut an explicit version
//   node scripts/release.mjs <version> --dry-run   # preview without writing
//   node scripts/release.mjs <version> --force     # skip the clean-tree check
//   node scripts/release.mjs <version> --no-sign   # do not GPG/SSH sign
//
// The target version must be greater than the current one in package.json.
//
// Flags:
//   --major     Bump the major component of the current version (+1, reset the
//               rest to zero).
//   --minor     Bump the minor component of the current version (+1, reset
//               patch to zero).
//   --patch     Bump the patch component of the current version (+1).
//   --dry-run   Print every planned action without modifying files, committing,
//               or tagging.
//   --force     Run even when the working tree is dirty. By default the script
//               aborts on a dirty tree so it never stomps concurrent work from
//               other sessions.
//   --no-sign   Override tag.gpgSign / commit.gpgSign for this run only, so the
//               release commit and tag are created unsigned. Use on a machine
//               whose signing key or agent is unavailable.
//
// The bump flags are mutually exclusive with each other and with an explicit
// <version>.
//
// Versioning model: single global release version per cut. Only packages that
// changed since the previous release tag (under packages/<name>/ or extensions/<name>/) OR
// that have a non-empty "## [Unreleased]" changelog section adopt the new
// version; unchanged packages keep their current version. The root package.json
// and the single v<version> tag always advance to the new version.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_ROOTS = ["packages", "extensions"];
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function parseSemver(v) {
  const m = SEMVER.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function formatSemver([maj, min, pat]) {
  return `${maj}.${min}.${pat}`;
}

function compareSemver(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

const args = process.argv.slice(2);
let dryRun = false;
let force = false;
let noSign = false;
let bumpMajor = false;
let bumpMinor = false;
let bumpPatch = false;
const positional = [];
for (const a of args) {
  if (a === "--dry-run") dryRun = true;
  else if (a === "--force") force = true;
  else if (a === "--no-sign") noSign = true;
  else if (a === "--major") bumpMajor = true;
  else if (a === "--minor") bumpMinor = true;
  else if (a === "--patch") bumpPatch = true;
  else positional.push(a);
}

const bumps = [
  ["--major", bumpMajor],
  ["--minor", bumpMinor],
  ["--patch", bumpPatch],
];
const activeBumps = bumps.filter(([, b]) => b);
const explicit = positional[0];

if (activeBumps.length > 1) {
  fail(
    `${activeBumps.map((f) => f[0]).join(", ")} are mutually exclusive; pick one.`,
  );
}
if (activeBumps.length === 1 && explicit !== undefined) {
  fail(`cannot combine ${activeBumps[0][0]} with an explicit version.`);
}
if (activeBumps.length === 0 && explicit === undefined) {
  console.error(
    "Usage: node scripts/release.mjs (--major|--minor|--patch|<X.Y.Z>) [--dry-run] [--force] [--no-sign]",
  );
  process.exit(2);
}

const currentVersion = JSON.parse(
  readFileSync(join(ROOT, "package.json"), "utf8"),
).version;
const currentParts = parseSemver(currentVersion);
if (!currentParts) {
  fail(`current version ${currentVersion} in package.json is not X.Y.Z.`);
}

let version;
if (activeBumps.length === 1) {
  const [maj, min, pat] = currentParts;
  if (bumpMajor) version = formatSemver([maj + 1, 0, 0]);
  else if (bumpMinor) version = formatSemver([maj, min + 1, 0]);
  else version = formatSemver([maj, min, pat + 1]);
} else {
  const parts = parseSemver(explicit);
  if (!parts) {
    fail(`version "${explicit}" is not X.Y.Z.`);
  }
  if (compareSemver(parts, currentParts) <= 0) {
    fail(
      `version ${explicit} must be greater than the current version ${currentVersion}.`,
    );
  }
  version = explicit;
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

let prevTag = null;
try {
  prevTag = git("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*");
} catch {
  prevTag = null;
}
let changedFiles = null;
if (prevTag !== null) {
  const out = git("diff", "--name-only", prevTag, "--", ...PACKAGE_ROOTS);
  changedFiles = out === "" ? [] : out.split("\n");
}

function pkgChangedByGit(path) {
  if (changedFiles === null) return true;
  const prefix = `${path}/`;
  return changedFiles.some((f) => f.startsWith(prefix));
}

const pkgPaths = PACKAGE_ROOTS.flatMap((root) =>
  readdirSync(join(ROOT, root), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `${root}/${e.name}`),
).sort();

function readPkg(dir) {
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
}

const rootPkg = readPkg(ROOT);
const toBump = [{ dir: ROOT, name: rootPkg.name, prev: rootPkg.version }];
const changelogModified = [];
const changelogCreated = [];
const changelogSkipped = [];
const notBumped = [];

for (const path of pkgPaths) {
  const dir = join(ROOT, path);
  const pkg = readPkg(dir);
  const cl = join(dir, "CHANGELOG.md");

  const gitChanged = pkgChangedByGit(path);
  let changelogChanged = false;
  const hasChangelog = existsSync(cl);
  if (hasChangelog) {
    const content = readFileSync(cl, "utf8");
    if (content.includes(`## [${version}]`)) {
      fail(`${rel(cl)} already contains a [${version}] section.`);
    }
    changelogChanged = unreleasedHasContent(content);
  }

  if (!gitChanged && !changelogChanged) {
    notBumped.push({ name: pkg.name, prev: pkg.version });
    continue;
  }

  toBump.push({ dir, name: pkg.name, prev: pkg.version });
  if (!hasChangelog) {
    changelogCreated.push(cl);
  } else if (changelogChanged) {
    changelogModified.push(cl);
  } else {
    changelogSkipped.push(cl);
  }
}

const rootCl = join(ROOT, "CHANGELOG.md");
if (existsSync(rootCl)) {
  const content = readFileSync(rootCl, "utf8");
  if (content.includes(`## [${version}]`)) {
    // already released; leave as-is
  } else if (unreleasedHasContent(content)) {
    changelogModified.push(rootCl);
  } else {
    changelogSkipped.push(rootCl);
  }
}

const anyChangelogWork =
  changelogModified.length > 0 || changelogCreated.length > 0;
if (toBump.length === 1 && !anyChangelogWork) {
  fail(`no packages changed since ${prevTag ?? "the start"}; nothing to release.`);
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

function unreleasedHasContent(content) {
  const header = "## [Unreleased]";
  const idx = content.indexOf(header);
  if (idx === -1) return false;
  const after = content.slice(idx + header.length);
  const next = after.indexOf("\n## ");
  const body = next === -1 ? after : after.slice(0, next);
  return body.trim() !== "";
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
  `Releasing ${toBump.length - 1} of ${pkgPaths.length} packages${tagSuffix}: ${version} (${today})`,
);

for (const { dir, name, prev } of toBump) {
  const label = dir === ROOT ? "(root)" : name;
  console.log(`  bump  ${label}  ${prev} -> ${version}`);
}
for (const { name, prev } of notBumped) {
  console.log(`  skip  ${name}  ${prev}`);
}

for (const cl of changelogModified) {
  console.log(`  changelog (update)  ${rel(cl)}`);
}
for (const cl of changelogCreated) {
  console.log(`  changelog (create)  ${rel(cl)}`);
}
for (const cl of changelogSkipped) {
  console.log(`  changelog (skip)    ${rel(cl)}`);
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
