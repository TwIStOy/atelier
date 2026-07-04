# @htwang-contrib/gondolin-sandbox

Runs pi's `read`, `write`, `edit`, and `bash` tools inside a local [Gondolin](https://github.com/earendil-works/gondolin) micro-VM so generated code executes in an isolated Linux guest instead of directly on the host. The host working directory is mounted read-write at `/workspace` inside the VM.

Disabled by default. Turn it on in `/config` under **Gondolin Sandbox**.

## Requirements

- QEMU on the host (`qemu-system-x86_64` on Linux, `qemu-system-aarch64` on Apple Silicon). On the first run, Gondolin downloads the default `alpine-base:latest` image (~200 MB) into `~/.cache/gondolin/images/`.
- `/dev/kvm` (Linux) or Hypervisor.framework (macOS) for hardware acceleration. The QEMU backend also works without acceleration, just slower.

## Configuration

All settings live under the `gondolin-sandbox` section in `~/.config/pi/extensions.json` and are editable through `/config`.

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` | Master switch. When off, pi behaves exactly as without this extension. |
| `allowedHosts` | string | `""` | Comma-separated HTTP egress allowlist (for example `api.github.com,registry.npmjs.org`). Empty means open egress — same as the upstream Gondolin default. |
| `image` | string | `alpine-base:latest` | Guest image selector resolved through the built-in image registry. |
| `memory` | string | `1G` | VM memory size forwarded to QEMU. |
| `cpus` | number | `2` | VM CPU count. |

## Behavior when enabled

- One long-lived VM is started lazily on the first tool call (and eagerly on `session_start`), then closed on `session_shutdown`.
- The system prompt's `Current working directory:` line is rewritten to point at `/workspace` so the model addresses the guest path.
- `user_bash` (`!command`) is also routed into the VM.

## Notes

- The VM guest runs as `root`. The mount is read-write, so files changed inside the VM change on the host immediately.
- Only HTTP egress is policy-controlled by `allowedHosts`. SSH/TCP egress and VFS hooks from the Gondolin SDK are not exposed here; extend this package if you need them.
