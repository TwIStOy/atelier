# Changelog

## [Unreleased]

### Added

- Package scaffold (`@htwang-contrib/llm-wiki`): standard monorepo layout (`main: src/index.ts`), devDeps aligned with sibling packages. The pi extension entry (`src/index.ts`) is an intentional no-op stub; the pi binding (config items, tools, commands) lands in #76+.
- `src/core/paths.ts` (pi-free): `vaultLayout(root)` returns every file and directory path of a vault per the PLAN.md layout, plus the `VAULT_DIR_NAME` constant.
- `src/core/vault.ts` (pi-free): `resolveVaults({ cwd, personalVaultPath? })` discovers the project vault by walking up from `cwd` for `.llm-wiki/` (nearest existing wins), and resolves the personal vault to the override or `~/.llm-wiki`. `defaultPersonalVaultPath(homedir?)` for injection.
- `src/core/atomic.ts` (pi-free): lock-free fs primitives per ADR-0002 — `atomicWriteFile` (tmp+rename), `appendJsonl` (append-only JSON lines), `contentHash` (sha256 hex), and `allocateSourcePacket` (mkdir-atomic `SRC-YYYY-MM-DD-NNN` allocation with EEXIST retry; date bucketed in UTC so the shared personal vault is stable across machines/timezones).
- `src/core/manifest.ts` (pi-free): `SourcePacketManifest` schema — origin discriminated by `sourceType` (`url` → url/title/contentType, `text` → title, `file` → originPath/originHash), plus `schemaVersion`, `id`, `packetDir`, `createdAt`, `contentHash`, `originalName`, and an `ingest` state (`status` pending/ingested/skipped). Atomic `readManifest`/`writeManifest` round-trip.
- `src/core/packet.ts` (pi-free): the Source Packet store — `captureSource()` for url/text/file. Writes `manifest.json` + `original/<name>` + `extracted.md` via the atomic primitives; idempotent dedup by scanning existing packets (file→originPath, url→url, text→contentHash), so repeated capture of the same key returns the existing packet with `created: false`. Fetches via an injected `UrlFetcher` port (keeps core pi-free) and supports cancellation through an optional `signal`; no packet dir is allocated when the fetch fails.
- `wiki_capture` pi tool (snake_case): captures a Raw Source into an immutable Source Packet. Resolves the project vault if present, else the personal vault. URL sources are fetched through the `@htwang-contrib/web-tools` provider chain (Jina/Firecrawl via the configured API keys; clear error when no fetch provider is configured). Re-capture of the same path/url/text is idempotent.
