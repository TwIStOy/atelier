# @htwang-contrib/gondolin-sandbox

Runs pi's `read`, `write`, `edit`, `bash`, `grep`, `find`, and `ls` tools inside a local [Gondolin](https://github.com/earendil-works/gondolin) micro-VM so generated code executes in an isolated Linux guest instead of directly on the host. The host working directory is mounted read-write at `/workspace` inside the VM.

Disabled by default. Turn it on in `/config` under **Gondolin Sandbox**.

## Requirements

- QEMU on the host (`qemu-system-x86_64` on Linux, `qemu-system-aarch64` on Apple Silicon). Gondolin guest images live in `~/.cache/gondolin/images/`.
- `/dev/kvm` (Linux) or Hypervisor.framework (macOS) for hardware acceleration. The QEMU backend also works without acceleration, just slower.
- `mke2fs`/`mkfs.ext4` on PATH, plus network access to `dl-cdn.alpinelinux.org`, to build the default `alpine-tools` image (one-time, see below).

## Building the default image

The default `image` is `alpine-tools:latest` — the standard `alpine-base` recipe plus `fd` and `ripgrep` in the guest rootfs. It is not published; build it once locally:

```bash
./node_modules/.bin/gondolin build \
  --config packages/gondolin-sandbox/image/build-config.json \
  --tag alpine-tools:latest
```

The build config pins `x86_64`; pass `--arch aarch64` on ARM hosts. Assets are cached in `~/.cache/gondolin/`, so rebuilds only fetch new packages. With the stock `alpine-base:latest` instead, the `find` tool fails on invocation (no `fd` in the guest).

Build notes:

- Requires `mke2fs`, `cpio`, and `lz4` on PATH (on NixOS: `nix-shell -p cpio lz4 e2fsprogs --run '...'`).
- The config pins the TUNA mirror (`alpine.mirror`) for the minirootfs/kernel fetch; on networks where `dl-cdn.alpinelinux.org` stalls, the cached minirootfs tarball must additionally be repacked with mirror URLs in `etc/apk/repositories` (package downloads read repos from the minirootfs, not the config).
- The libkrunfw asset comes from GitHub releases; if unreachable, place `libkrunfw-x86_64.tgz` under `~/.cache/gondolin/build/libkrunfw/downloads/v5.2.1/x86_64/` before building.

## Configuration

All settings live under the `gondolin-sandbox` section in `~/.config/pi/extensions.json` and are editable through `/config`.

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` | Master switch. When off, pi behaves exactly as without this extension. |
| `allowedHosts` | string | `""` | Comma-separated HTTP egress allowlist (for example `api.github.com,registry.npmjs.org`). Empty means open egress — same as the upstream Gondolin default. |
| `extraMounts` | string | `""` | Comma-separated extra host mounts as `hostPath:guestPath[:ro\|:rw]` (for example `/tmp:/tmp,/nix/store:/nix/store:ro`). Host paths outside the workspace and these mounts are rejected by the tools. `~` expands to the host home. Keep guest path equal to host path when bash commands reference it. |
| `image` | string | `alpine-tools:latest` | Guest image selector resolved through the image registry. The default adds `fd`/`ripgrep` to `alpine-base`; build it once (see below). |
| `memory` | string | `1G` | VM memory size forwarded to QEMU. |
| `cpus` | number | `2` | VM CPU count. |

## Behavior when enabled

- One long-lived VM is started lazily on the first tool call (and eagerly on `session_start`), then closed on `session_shutdown`.
- The system prompt's `Current working directory:` line is rewritten to point at `/workspace` so the model addresses the guest path; extra mounts are appended to the prompt when configured.
- Paths outside the workspace and any `extraMounts` are rejected with a `path escapes sandbox mounts` error listing the allowed roots. Missing host paths in `extraMounts` are skipped with a warning instead of failing VM startup.
- Extra mounts become Gondolin VFS mounts: `vm.fs` calls short-circuit to the host provider, and the guest sees them via fuse binds at the configured guest path (`ro` mounts reject writes with `EROFS`).
- `user_bash` (`!command`) is also routed into the VM.
- `grep`: the `rg` search process itself still runs on the host (pi's grep tool spawns it outside the operations interface); directory checks and context-line reads go through `vm.fs`. Since `/workspace` is backed by the host directory, search results are identical. `rg` is also installed inside the guest for bash usage.
- `find`: runs `fd` **inside the guest** (`/usr/bin/fd`) with the same argument construction as pi's host implementation (`--glob --hidden`, `--max-results`, `--full-path` handling, `.gitignore`-aware git detection). Requires the `alpine-tools` image (or any image shipping `fd`).
- `ls`: directory listing goes through `vm.fs` (`stat`/`listDir`).

## Notes

- The VM guest runs as `root`. The mount is read-write, so files changed inside the VM change on the host immediately.
- Only HTTP egress is policy-controlled by `allowedHosts`. SSH/TCP egress and VFS hooks from the Gondolin SDK are not exposed here; extend this package if you need them.
