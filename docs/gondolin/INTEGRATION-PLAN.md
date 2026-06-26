# Gondolin Integration Plan

> Companion to [OVERVIEW.md](./OVERVIEW.md). Read that first.
> This is a **plan**, not an implementation. No code is changed here.

## 1. Goal

Add a first-class pi extension, **`@htwang-contrib/gondolin`**, that runs the
agent's `read` / `write` / `edit` / `bash` (and `!` commands) inside a Gondolin
micro-VM instead of on the host, with network egress and secrets under
host-side policy. It composes with — does not replace — `protect-secrets` and
`web-tools`.

The upstream reference is
[`host/examples/pi-gondolin.ts`](https://github.com/earendil-works/gondolin/blob/main/host/examples/pi-gondolin.ts).
We adapt it into a proper package in this monorepo, adding config, policy hooks,
graceful degradation, and tests.

## 2. Design decisions (need confirmation)

These are the non-obvious choices. I've taken a position on each; flag if you
disagree.

| # | Decision | Position | Rationale |
| --- | --- | --- | --- |
| D1 | Use the SDK directly as a runtime dependency | **Yes**, `@earendil-works/gondolin@^0.12.0` in `dependencies` | Matches the repo rule "prefer existing packages over reimplementing". The SDK is the supported public surface. The official pi example also pins `0.12.0`. |
| D2 | Backend | **QEMU only** for v1 | `krun` is experimental, needs Zig + Rust + libkrun build, and is Linux-x86 smoke-tested only. QEMU works on our macOS+NixOS targets. |
| D3 | Mount mode for `/workspace` | **`RealFSProvider(cwd)` read-write** (matches upstream) | The agent needs to actually edit the project. Read-only would defeat the purpose. We rely on network policy + secret non-exposure for safety. |
| D4 | Network default | **Deny-all** (no `allowedHosts`) until the user/project configures egress | Safe default; agent must request or config the hosts it needs. Opposite of upstream example (which shows allowlists inline). |
| D5 | Secrets source | **Manual config** in v1 (a config item mapping `SECRET_NAME → host env var name`); Gondolin reads the real value on the host at VM create | Never expose agenix paths to the guest; the host reads the secret and feeds `createHttpHooks`. |
| D6 | Activation | **Off by default**; enabled via config item (`gondolin.enabled`) + a runtime toggle command | A micro-VM has real startup cost and a QEMU dependency. Must not break existing sessions on machines without QEMU. |
| D7 | VM lifetime | **One VM per pi session** (start on `session_start`, close on `session_shutdown`) | Matches upstream and keeps state coherent within a session. Snapshots are a later phase. |
| D8 | Config mechanism | Reuse **`registerConfigItems`** from `@htwang-contrib/common`, surfaced via `/config` → `extension-config-ui` | Matches the user's stated preference over a dedicated `/command` for settings. A `/gondolin` command stays for the *verb* (toggle at runtime, status). |

## 3. Package layout

New package at `packages/gondolin/`, following the `web-tools`/`committer` shape.
The structure mirrors the **official pi example** (`packages/coding-agent/examples/extensions/gondolin`),
which overrides all 7 file/shell tools — not just 4. We split its single
`index.ts` into modules for testability.

```
packages/gondolin/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts            # default export: registerConfigItems + tools + hooks + /gondolin
│   ├── vm.ts               # VM lifecycle (start/ensure/close), singleflight, bash probe, QEMU-absent fallback
│   ├── config.ts           # config schema, load/save, registerConfigItems wrapper
│   ├── paths.ts            # host<->guest path mapping (toGuestPath, hostPathToGuest, matchesToolGlob)
│   ├── walk.ts             # walkGuestFiles (skips .git/node_modules) reused by find+grep
│   ├── ops/
│   │   ├── read.ts         # ReadOperations   via vm.fs.readFile/access + ext-based MIME
│   │   ├── write.ts        # WriteOperations  via vm.fs.writeFile/mkdir({recursive})
│   │   ├── edit.ts         # EditOperations   = read.readFile + read.access + write.writeFile
│   │   ├── bash.ts         # BashOperations   via vm.exec([shell,"-lc",cmd]) streamed
│   │   ├── ls.ts           # LsOperations     via vm.fs.exists/stat/listDir
│   │   ├── find.ts         # FindOperations   via walkGuestFiles + matchesToolGlob
│   │   └── grep.ts         # grep executor    TS line-match with context/limit/truncation
│   ├── policy/
│   │   ├── http.ts         # build createHttpHooks({allowedHosts, secrets, blockInternalRanges})
│   │   └── secrets.ts      # resolve secret values from host env, build secrets map + SecretManager
│   └── hooks.ts            # before_agent_start (rewrite CWD), user_bash, session lifecycle
├── test/
│   ├── paths.test.ts       # toGuestPath / hostPathToGuest / glob matching (no QEMU needed)
│   ├── walk.test.ts        # walkGuestFiles skip rules + limit (mocked vm.fs)
│   ├── policy.test.ts      # allowedHosts matching, internal-range blocking
│   └── grep.test.ts        # line matcher, context window, match-limit formatting
└── ...
```

`packages/gondolin/package.json` (sketch — matches the example's dep pin + our peer pattern):

```jsonc
{
  "name": "@htwang-contrib/gondolin",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "pi": { "extensions": ["./index.ts"] },
  "dependencies": {
    "@earendil-works/gondolin": "^0.12.0",
    "@htwang-contrib/common": "*"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*"
  },
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "latest",
    "@earendil-works/pi-tui": "latest",
    "@types/node": "^26.0.0",
    "typescript": "^6.0.0",
    "vitest": "^4.1.9"
  }
}
```

Then register it in the root `package.json` under `pi.extensions`.

## 4. Wiring into pi

The extension overrides the **seven** built-in file/shell tools by
re-registering them with VM-backed operations, exactly as the official example
does. Pi supports this: each `createXTool(cwd, { operations })` accepts an
injectable ops object, and the tool's own `execute` is reused. `grep` is the
exception — it has no ops injection, so its executor is reimplemented in TS.

```ts
export default function (pi: ExtensionAPI): void {
  registerGondolinConfigItems();        // D8

  pi.on("session_start", async (_e, ctx) => { if (enabled()) await ensureVm(ctx); });
  pi.on("session_shutdown", async (_e, ctx) => { await closeVm(ctx); });
  pi.on("before_agent_start", rewriteCwdHook);   // show /workspace in prompt
  pi.on("user_bash", (_e, ctx) => vmBashOpsIfActive());

  registerGondolinTools(pi);  // re-registers read/write/edit/bash/ls/find/grep
  pi.registerCommand("gondolin", gondolinCommand); // status (+ allow, in our version)
}
```

Tool override approach (per official example): spread the stock tool definition
(`name`, `description`, `inputSchema`, `render` …) and replace `execute` so it
lazily `ensureVm`s, then delegates to a tool built with
`{ operations: vmBackedOps }` and `cwd: GUEST_WORKSPACE`. Each re-registered
execute calls the underlying tool's `execute(id, params, signal, onUpdate)` —
no reimplementation of the tool's own rendering/truncation logic. When the
extension is **disabled**, we do nothing — the stock host tools remain in place
untouched.

### Why `vm.fs` instead of shell-out

The official example reads/writes via the **`vm.fs` API**
(`readFile`/`writeFile`/`mkdir`/`access`/`stat`/`listDir`) rather than
shelling out (`vm.exec(["cat", ...])` / base64 round-trip). This is RPC over
virtio-serial to `sandboxfs`, avoids shell quoting/encoding bugs, and supports
streaming. We follow it.

### Why grep/find are reimplemented in TS

The minimal Alpine guest has no ripgrep, and `vm.fs` has no search primitive.
So the example walks files in TS (`walkGuestFiles`, skipping `.git`/
`node_modules`) and line-matches in JS. We reuse this; it also keeps these ops
unit-testable without QEMU.

## 5. Path mapping (`paths.ts`)

The agent thinks in host paths (the CWD it was started in). Inside the VM the
project lives at `/workspace`. We follow the official example's **passthrough**
semantics (not the old example's reject-on-escape):

- `hostPathToGuest(hostCwd, hostPath)`: if the path is inside `hostCwd`, rewrite
  to `/workspace/<rel>`; otherwise return the POSIX-normalized absolute path
  unchanged (so the agent can still read guest system files like `/etc/...`).
- `toGuestPath(hostCwd, inputPath)`: handles `@`-prefixed paths, empty input,
  and absolute-vs-relative inputs; resolves relatives against `/workspace`.
- `toPosix`: convert platform separators to POSIX for the Linux guest.
- `matchesToolGlob`: glob matching with `**/` prefix fallback for bare patterns.

This is the most bug-prone piece (host macOS path semantics vs guest Linux), so
it gets dedicated unit tests independent of QEMU.

## 6. Networking & secrets policy (`policy/`)

- `createHttpHooks({ allowedHosts, secrets, blockInternalRanges: true })`.
- **Default `allowedHosts: []`** → all egress blocked. Surfaced as a status line
  ("Gondolin: egress denied (no allowed hosts)") so the agent/user understands
  failures. (Note: omitting `allowedHosts` entirely means allow-all; we pass an
  explicit empty array for deny-all.)
- `allowedHosts` is configurable (config item + `/gondolin allow <host>`).
- Secrets: config maps a logical name to a **host env var**; the host reads
  `process.env[VAR]` at VM create and passes the value to `createHttpHooks`.
  The guest only ever sees the placeholder. We never mount `~/.config`,
  `~/.aws`, `.env`, or agenix paths into the guest.
- `createHttpHooks` returns a **`secretManager`** (list/update/delete) so we can
  rotate a secret at runtime after the VM is up without recreating it — useful
  for `/gondolin secret set NAME=VAR` without a full VM restart.

## 7. Graceful degradation

On `session_start` (or first tool use), `ensureVm` must handle the "QEMU
missing / assets not cached / boot failed" cases without bricking the session:

1. Probe QEMU availability (e.g. `which qemu-system-*` or a cheap VM.create
   attempt with a short timeout).
2. On failure: `ctx.ui.notify(..., "warning")`, set status, and **fall back to
   host tools** for the rest of the session (i.e. the overridden tools detect
   `vm === null` after a failed ensure and delegate to the stock tool). This
   keeps the extension non-fatal.

This is an explicit deviation from upstream, which lets the error propagate.

## 8. Composing with existing extensions

- **`protect-secrets`**: keep it. Inside the VM the agenix paths aren't mounted,
  so its block is structural rather than advisory, but it still guards the
  *host* `read`/`bash` when Gondolin is disabled. No conflict — different layers.
- **`web-tools`**: keep it. Its SSRF guard applies to the *host-side* fetch the
  agent makes via the `web_fetch` tool; Gondolin's policy applies to *guest*
  egress. Orthogonal. Note: when Gondolin is active, `web_fetch` still runs on
  the host (we only override read/write/edit/bash), so `web-tools`' guard still
  applies.
- **`subagents`**: subagents inherit the parent's tool registry, so a
  Gondolin-backed session gives subagents VM-backed tools too. Verify during
  testing; no code change expected.

## 9. Phased rollout

Phases track the module groups. Each phase is independently testable.

| Phase | Scope | Exit criteria |
| --- | --- | --- |
| **P0 — Skeleton** | package scaffold (`package.json`/`tsconfig.json`), config items (enabled, allowedHosts, image), register in root `package.json`, `npm run check` clean | loads in pi without error when disabled |
| **P1 — VM lifecycle + paths** | `vm.ts` (start/ensure/close, singleflight, bash probe, QEMU-absent fallback), `paths.ts` + tests, `walk.ts` + tests, `session_start`/`shutdown` hooks, status line | a session boots a VM on a QEMU machine; `toGuestPath`/`hostPathToGuest`/`matchesToolGlob`/`walkGuestFiles` tests pass |
| **P2 — 7 tool overrides** | `ops/{read,write,edit,bash,ls,find,grep}.ts` via `vm.fs` + TS grep, re-register all 7 + `user_bash`, `before_agent_start` CWD rewrite, `/gondolin` status | agent can read/edit/write/bash/ls/find/grep inside `/workspace`; host files outside project are reachable only as guest system paths (passthrough) |
| **P3 — Policy** | `policy/http.ts`, `policy/secrets.ts`, deny-by-default egress, `/gondolin allow <host>`, secret mapping config, runtime `secretManager` updates | guest cannot curl a denied host; can curl an allowed host with header-injected secret; secret rotate works without VM restart |
| **P4 — Hardening** | error paths, timeouts, streaming correctness, `committer`/`web-tools` composition tests, README, CHANGELOG `[Unreleased]` | full `npm run check` + `npm test` green; manual run-through on macOS+NixOS |

Snapshots, ingress, SSH egress, and the `krun` backend are explicitly **out of
scope** for v1.

## 10. Open questions for the user

1. **Mount mode** — confirm read-write `RealFSProvider` for `/workspace` (D3),
   or do you want read-only by default with an explicit opt-in for write?
2. **Network default** — confirm deny-all (D4), or ship a minimal default
   allowlist (e.g. package registries) so common workflows work out of the box?
3. **Secrets source** — confirm "logical name → host env var" config (D5), or do
   you want integration with agenix paths read *by the host only* (never
   mounted into the guest)?
4. **Scope of v1** — confirm QEMU-only, per-session VM, no snapshots/ingress/SSH
   (D2/D7 + phase table), or pull any of those in?

## 11. Risks

- **QEMU dependency** is heavy and not universally present; mitigated by D6
  (off by default) and §7 (fallback).
- **Path-mapping bugs** (host↔guest) could misroute reads/writes; mitigated by
  the passthrough semantics proven in the official example + dedicated unit
  tests for `toGuestPath`/`hostPathToGuest`/`matchesToolGlob`.
- **TS grep is slower** than native ripgrep for large repos; the official
  example accepts this tradeoff (minimal guest has no ripgrep). `walkGuestFiles`
  skips `.git`/`node_modules` to bound work. Flag for users who grep huge trees.
- **Cold-start latency** (~1s boot + asset download on first use) may surprise
  users; mitigated by eager `session_start` boot and clear status messaging.
- **MITM CA trust**: the guest trusts Gondolin's injected CA. The host CA key
  lives under `~/.cache/gondolin/ssl` — document as sensitive.
- **Exfiltration to *allowed* hosts is not prevented** by design; document in
  the package README so users don't mount sensitive data RW alongside a broad
  allowlist.
