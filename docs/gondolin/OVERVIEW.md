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

await vm.close();
```

VM supports snapshots (`vm.snapshot()` / `--resume`), ingress gateway
(`vm.enableIngress()`, `--listen`), and host→guest SSH (`vm.enableSsh()`).

## 7. Existing upstream Pi integration

The repo ships an example at
[`host/examples/pi-gondolin.ts`](https://github.com/earendil-works/gondolin/blob/main/host/examples/pi-gondolin.ts).
It demonstrates the exact pattern relevant to us: it **overrides pi's built-in
`read`/`write`/`edit`/`bash` tools** so they execute inside the VM instead of
on the host. Pi exposes injectable operation interfaces for each tool
(`ReadOperations`, `WriteOperations`, `EditOperations`, `BashOperations`), and
the example provides VM-backed implementations of each:

- `read` → `cat` the guest path
- `write` → base64 round-trip into the guest file
- `edit` → compose of read + write
- `bash` → `vm.exec(["/bin/bash","-lc",command])` with streamed output,
  per-command cwd, env, signal, and timeout
- `user_bash` (the `!` commands) → same VM-backed bash ops
- `before_agent_start` → rewrites the system-prompt CWD line to show
  `/workspace` so the model sees the guest path
- mounts the host CWD read-write at `/workspace` via `RealFSProvider`

This example is a **behavior and API reference**, not a drop-in: it lives in
the gondolin repo, uses inline type fixes (`Record` without type args — a
stripped artifact of fetching), has no config, no policy hooks, no tests, and
isn't wired to this monorepo's conventions. The integration plan
(`INTEGRATION-PLAN.md`) describes how to adapt it into a first-class package
here.

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
