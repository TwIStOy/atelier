# release.mjs

Cut a unified release across every package in the monorepo. For a given
version it bumps every `package.json`, updates every `CHANGELOG.md`, creates a
single release commit, and tags that commit. It does **not** publish to npm and
does **not** push to git.

## Usage

```
node scripts/release.mjs <version>            # cut the release
node scripts/release.mjs <version> --dry-run  # preview without writing
node scripts/release.mjs <version> --force    # skip the clean-tree check
node scripts/release.mjs <version> --no-sign  # do not GPG/SSH sign
```

Sample output:

```
Releasing 29 packages (DRY RUN, NO SIGN): 0.2.0 (2026-07-06)
  bump  @htwang-contrib/common   0.1.0 -> 0.2.0
  bump  @htwang-contrib/memory   0.1.0 -> 0.2.0
  ...
  changelog (update)  CHANGELOG.md
  changelog (update)  packages/memory/CHANGELOG.md
  changelog (create)  packages/committer/CHANGELOG.md
  ...

Done.
  commit  a1b2c3d4   chore(release): v0.2.0
  tag     v0.2.0

Not pushed. When ready:
  git push origin master
  git push origin v0.2.0
```

The parenthesized flags echo what is active: `DRY RUN`, `NO SIGN`, `FORCE`.

## What it does

1. **Version bump** — sets `"version"` in the root `package.json` and every
   `packages/*/package.json` to the target version. Key order and trailing
   newline are preserved; only the version value changes.
2. **Changelogs** — for every `packages/*/CHANGELOG.md` and the root
   `CHANGELOG.md`, the current `## [Unreleased]` section is turned into a dated
   `## [<version>] - <date>` section and a fresh empty `## [Unreleased]` is
   opened above it. Packages with no `CHANGELOG.md` get one created with an
   `Initial release.` entry under the version.
3. **Commit** — stages exactly the bumped `package.json` files and the
   touched changelogs, then commits as `chore(release): v<version>`.
4. **Tag** — creates one annotated tag `v<version>` on that commit.

Nothing is published to npm and nothing is pushed to the remote. Push manually
when you are ready:

```
git push origin master
git push origin v0.2.0
```

## Flags

- `<version>` — required, must be `X.Y.Z` (no leading `v`).
- `--dry-run` — print every planned action (version bumps, changelog
  updates/creates, the commit subject and tag) without modifying files,
  committing, or tagging.
- `--force` — run even when the working tree is dirty. By default the script
  aborts on a dirty tree so it never accidentally bundles or stomps concurrent
  work from other sessions.
- `--no-sign` — override `tag.gpgSign` / `commit.gpgSign` for this run only,
  creating the release commit and tag unsigned. Use on a machine whose signing
  key or SSH agent is unavailable. The override is scoped to this invocation
  via `git -c ...`; it does not touch your global or repo git config.

## Versioning model

**Unified.** Every package shares one version number and ships together under a
single `v<version>` tag. The release commit and tag cover the whole monorepo;
individual packages are not tagged separately.

## Guards

- Aborts if tag `v<version>` already exists.
- Aborts if any changelog already contains a `## [<version>]` section (prevents
  double-releasing the same version).
- Aborts if the working tree is dirty, unless `--force` is given.
