# Changelog

## [Unreleased]

### Added

- Package scaffold (`@htwang-contrib/llm-wiki`): standard monorepo layout (`main: src/index.ts`), devDeps aligned with sibling packages. The pi extension entry (`src/index.ts`) is an intentional no-op stub; the pi binding (config items, tools, commands) lands in #76+.
- `src/core/paths.ts` (pi-free): `vaultLayout(root)` returns every file and directory path of a vault per the PLAN.md layout, plus the `VAULT_DIR_NAME` constant.
- `src/core/vault.ts` (pi-free): `resolveVaults({ cwd, personalVaultPath? })` discovers the project vault by walking up from `cwd` for `.llm-wiki/` (nearest existing wins), and resolves the personal vault to the override or `~/.llm-wiki`. `defaultPersonalVaultPath(homedir?)` for injection.
- `src/core/atomic.ts` (pi-free): lock-free fs primitives per ADR-0002 — `atomicWriteFile` (tmp+rename), `appendJsonl` (append-only JSON lines), `contentHash` (sha256 hex), and `allocateSourcePacket` (mkdir-atomic `SRC-YYYY-MM-DD-NNN` allocation with EEXIST retry; date bucketed in UTC so the shared personal vault is stable across machines/timezones).
