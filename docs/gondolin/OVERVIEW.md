# Gondolin — Overview

> Source: <https://github.com/earendil-works/gondolin>
> npm: `@earendil-works/gondolin` · License: Apache-2.0
> Docs: <https://earendil-works.github.io/gondolin/>

## 1. What it is

Gondolin is a **local Linux micro-VM sandbox** with a TypeScript control plane.
You boot a throwaway Linux VM (QEMU by default, optional experimental `krun`
backend) on your own machine in under a second, run arbitrary/untrusted code
inside it, and keep the VM's **I/O surface — network egress and filesystem —
under host-side policy you write in TypeScript/JavaScript**.

It targets the specific problem: **AI agents generate code that runs without
human review, and that code needs network access and credentials.** Running it
on the host directly creates credential-exfiltration and SSRF risk. Gondolin
narrows that risk by making the host the enforcement point.

## 2. Core value for this monorepo

Pi (and therefore every extension in `pi-extensions`) gives the agent `read`,
`write`, `edit`, and `bash` tools that operate **on the host directly**. Two
existing extensions already react to the danger that creates:

- `protect-secrets` — blocks `read`/`glob`/`grep`/`bash` from touching
  agenix-managed secret paths (`/run/agenix`).
- `web-tools` — refuses loopback / RFC1918 / link-local / cloud-metadata URLs.

Both are **block-list** defenses bolted onto the host tools. Gondolin is the
**allow-list / capability** complement: instead of trying to enumerate
everything bad on the host, run the dangerous turn inside a VM that has *no*
network and *no* host filesystem by default, and grant exactly the hosts and
files the task needs.

## 3. Architecture (control plane vs data plane)

```
+--------------------------- Host machine (trusted) ---------------------------+
|  Your Node.js app / pi extension (policy + secrets + VFS providers)         |
|  +------------------------------ VM boundary ------------------------------+ |
|  |  Guest Linux VM (untrusted)                                            | |
|  |   [virtio-net] eth0  <--Ethernet frames-->  host network backend       | |
|  |   [virtio-serial] exec RPC  <---------->  sandbox server               | |
|  |   [virtio-serial] fs RPC   <---------->  VFS RPC service               | |
|  |   [virtio-serial] ssh fwd  <---------->  loopback-only proxy           | |
|  |   [virtio-serial] ingress  <---------->  ingress gateway               | |
|  +------------------------------------------------------------------------+ |
+------------------------------------------------------------------------------+
```

- **Host (TypeScript control plane)** — `@earendil-works/gondolin`. Spawns the
  VM, provides `vm.exec(...)`, the programmable filesystem (VFS providers), and
  the programmable network policy (HTTP/TLS mediation + hooks, optional
  SSH/mapped-TCP exception paths). Downloads/caches guest assets on demand.
- **Guest (Zig + init scripts, untrusted)** — minimal Linux userspace.
  `sandboxd` runs commands, `sandboxfs` is a FUSE daemon that turns file ops
  into RPCs back to the host, `sandboxssh`/`sandboxingress` are loopback-only
  forwarders.
- **VM backend** — QEMU (default, primary isolation boundary) or `libkrun`
  (experimental, faster cold start, narrower parity).

The defining design choice: **the host is the policy enforcement point for both
networking and persistence.** The guest is treated as adversarial.

## 4. What runs where

**`vm.exec(...)`** — host sends an exec request over virtio-serial; `sandboxd`
in the guest spawns the process and streams stdout/stderr/stdin back. So you
get a clean programmatic API without SSH for normal operation.

**Network access** — the host does **not** give the guest a NAT. It runs its own
userspace network stack:

1. For each outbound TCP flow, check explicit `tcp.hosts` mapped rules first;
   otherwise sniff and classify as `http` / `tls` / `ssh` / **denied**.
   `HTTP CONNECT` is explicitly denied.
2. UDP is blocked except DNS (port 53), and DNS is mode-dependent
   (`synthetic` default = no upstream DNS, host returns synthetic answers).
3. HTTP is parsed and replayed by the host via `fetch`; TLS is **MITM'd** so the
   host can see and policy-check the inner HTTP request, then replayed.
4. `createHttpHooks()` produces request-content policy (`isRequestAllowed`) and
   destination-IP policy (`isIpAllowed`) that blocks internal ranges
   (127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/0, 0.0.0.0/8,
   IPv6 loopback/link-local/ULA/IPv4-mapped) by default.
5. DNS-rebinding protection: policy is re-checked after hostname resolution and
   again at connect time via a guarded undici dispatcher.

**Secrets** — the guest never sees real values. You pass secrets to
`createHttpHooks({ secrets })`; the guest receives **random placeholders** as
env vars. When the guest makes an allowed HTTP request, the host substitutes
placeholders → real values **only in headers** (`Authorization: Bearer …` and
`Authorization: Basic …` included; query-param substitution is opt-in and
riskier). If a placeholder is sent to a non-allowed host, the request is
blocked.

**Filesystem** — the guest gets an ephemeral image-backed root plus tmpfs, and
optional FUSE mounts served by host providers (`MemoryProvider`,
`RealFSProvider`, `ReadonlyProvider`, custom). The guest cannot touch host
files unless you mount them.

## 5. Security model summary

**Protects against:** credential theft (secrets never enter the guest), network
egress to unintended hosts, and host-filesystem access.

**Does NOT protect against:** a malicious host process, a malicious local user,
VM/hypervisor escape (a QEMU escape = host compromise), side channels, or DoS.
It also does **not** stop the guest from uploading arbitrary data it can read
to an *allowed* host (so don't mount sensitive data read-write and then allow a
host that can echo it back, e.g. httpbin).

**Safe operating envelope:** use exact-host allowlists (avoid `*`), keep
`blockInternalRanges: true`, provide secrets *only* via `createHttpHooks`
(never `VM.env` and never by mounting `~/.aws`/`.env`), default `/workspace` to
`MemoryProvider`, and wrap real host dirs in `ReadonlyProvider`.

## 6. Public API surface (what we'd consume)

```ts
import {
  VM,
  createHttpHooks,
  RealFSProvider,   // host dir as a mount
  MemoryProvider,   // scratch space
  ReadonlyProvider, // read-only wrapper
} from "@earendil-works/gondolin";

const vm = await VM.create({
  httpHooks,   // from createHttpHooks(...)
  env,         // placeholder env vars from createHttpHooks(...)
  vfs: { mounts: { "/workspace": new RealFSProvider(hostDir) } },
  // optional: dns, ssh, ingress, sandbox (vmm/image/rootfs), tcp.hosts
});

const result = await vm.exec("...");   // string  => /bin/sh -lc "..."
await vm.exec(["/bin/cat", path]);     // array   => direct exec (no $PATH search)

// First-class guest filesystem API (preferred over shelling out):
await vm.fs.readFile("/workspace/file.txt", { encoding: "utf8" }); // -> string
await vm.fs.readFile("/workspace/binary");                          // -> Buffer
await vm.fs.writeFile("/workspace/out.txt", "content");
await vm.fs.mkdir("/workspace/dir", { recursive: true });
await vm.fs.access("/workspace/file");        // throws if absent
await vm.fs.stat("/workspace/file");          // -> node:fs Stats
await vm.fs.listDir("/workspace/dir");        // -> string[] of entry names

await vm.close();
```

VM supports checkpoints (`vm.checkpoint(path)` / `--resume`), ingress gateway
(`vm.enableIngress()`, `--listen`), and host→guest SSH (`vm.enableSsh()`).
`createHttpHooks(...)` returns a `secretManager` for runtime secret
add/update/delete after the VM is running.

## 7. Official upstream Pi example

The **pi** repo ships a full reference extension at
[`packages/coding-agent/examples/extensions/gondolin`](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/gondolin)
(`index.ts`, `package.json`, depends on `@earendil-works/gondolin@0.12.0`).
This is the authoritative reference for our integration — more complete than
the older `host/examples/pi-gondolin.ts` in the gondolin repo (which only
overrode 4 tools via shell-out).

**What it overrides** — **all 7** built-in file/shell tools, by re-registering
them with VM-backed `*Operations` implementations (pi exposes injectable
operation interfaces for each):

| Tool | Ops interface | Implementation |
| --- | --- | --- |
| `read` | `ReadOperations` | `vm.fs.readFile` / `vm.fs.access`; image MIME by extension |
| `write` | `WriteOperations` | `vm.fs.writeFile` / `vm.fs.mkdir({recursive})` |
| `edit` | `EditOperations` | composes read.`readFile` + read.`access` + write.`writeFile` |
| `bash` | `BashOperations` | `vm.exec([shell,"-lc",cmd])`, streamed, with cwd/env/signal/timeout |
| `ls` | `LsOperations` | `vm.fs.exists` / `stat` / `listDir` |
| `find` | `FindOperations` | TS `walkGuestFiles` + `matchesToolGlob` over `vm.fs` |
| `grep` | custom executor | TS reimplementation: walks files, line-matches, builds `path:line: text` blocks with context/limit/truncation (no native ripgrep in guest) |

Plus hooks:
- `user_bash` (the `!` commands) → VM-backed bash ops.
- `before_agent_start` → rewrites the system-prompt CWD line to `/workspace` so
  the model sees the guest path.
- `session_start` → eagerly boots the VM; `session_shutdown` → closes it.
- `/gondolin` command → show VM id / host<->guest mapping / detected shell.

**Key implementation choices worth reusing**:
- **`vm.fs` API, not shell-out.** Read/write/ls go through the first-class
  `vm.fs.*` methods (RPC over virtio-serial), avoiding quoting/encoding bugs
  the old `cat`/base64 approach had.
- **Bash probe at boot.** Runs `command -v bash || true`; uses `/bin/bash` if
  present, else `/bin/sh`. The detected path is reused by every bash exec.
- **Path mapping passes through** outside-workspace paths instead of rejecting
  them: `hostPathToGuest` returns the POSIX-normalized absolute path for paths
  outside the project, so the agent can still read guest system files. Only
  in-workspace paths are rewritten to under `/workspace`.
- **Grep/glob reimplemented in TS** because the minimal guest image has no
  ripgrep; `walkGuestFiles` skips `.git`/`node_modules` and supports a limit.
- **Singleflight VM start.** `ensureVm` dedups concurrent boot attempts via a
  shared `vmStarting` promise.
- Mounts the host CWD read-write at `/workspace` via `RealFSProvider`.

All 19 pi-coding-agent symbols the example imports (`createReadTool` …
`GrepToolInput`, plus `truncateHead`/`truncateLine`/`formatSize`/
`DEFAULT_MAX_BYTES`) **exist in our installed `pi-coding-agent@0.80.2`**
(verified). The example is still a reference, not a drop-in: it has no config,
no network/secrets policy, no tests, no graceful degradation, and isn't wired
to this monorepo's conventions. The integration plan (`INTEGRATION-PLAN.md`)
describes how to adapt it into a first-class package here.

## 8. Requirements & constraints

- **QEMU** installed (`brew install qemu` on macOS; `qemu-system-arm` on
  Debian/Ubuntu). `krun` is optional/experimental and needs extra build steps.
- **Node.js >= 23.6.**
- Best-tested on **ARM64** (Apple Silicon, Linux aarch64). Linux x86_64
  `krun` is CI smoke-tested only.
- Guest assets (~200MB+) are auto-downloaded on first use and cached under
  `~/.cache/gondolin/`.

For our NixOS/macOS dev environments (see profile), QEMU is available; the
extension should degrade gracefully (or refuse to enable) when QEMU is absent.

## 9. Relation to existing extensions

| Existing extension | Defense style | Gondolin relationship |
| --- | --- | --- |
| `protect-secrets` | block-list on host paths | Complementary; inside the VM the host secret paths are simply not mounted, so the block becomes structural. |
| `web-tools` (SSRF guard) | block-list on URLs | Complementary; Gondolin's `createHttpHooks` is the same idea applied to *all* guest egress, enforced at the VM boundary. |
| `extra-tools` / `bash` | direct host exec | Gondolin replaces these with VM-backed ops when active. |

Gondolin is **not** a replacement for the above; it's an **isolation layer**
that can sit underneath them. The integration plan defines how they compose.
