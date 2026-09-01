# Idle compaction uses ctx.compact() semantic summary, not sync truncation

When a session sits idle long enough for the upstream prompt cache TTL to expire (observed: 30–90 minutes), the next request re-reads the entire context at full price. Idle compaction (#107) compacts before that request fires. Two mechanisms were considered for it: `ctx.compact()` (LLM-generated semantic summary, a standalone request with `cacheRetention: "none"`) and the sync hard truncation already used by the emergency checkpoint (zero LLM cost, but old history is replaced by a one-line notice).

We chose the semantic summary. Cost-wise both paths pay one full-price read of the old context — the summary call reads it uncached, the no-compact path re-reads it as the rewarm — so the difference is the cache re-write and subsequent hit sizes, where compaction wins decisively for large contexts (~85% saving at ~300k tokens). Truncation would be ~10x cheaper on the first turn alone, but for the flagship scenario (resuming an overnight task) the dropped history carries the task setup; a notice line is not a summary, and the emergency path only tolerates the hard cut because a proper compact follows it.

Consequence: idle compaction is a net loss for small contexts (the summary call costs as much as the rewarm it avoids), so it carries a hardcoded idle floor — it never fires below 50% of the context window.

## Considered Options

- **Sync truncation (keep-recent)** — rejected: information-destructive without a follow-up summary; the "context compacted" notice would be lying about having summarized.
- **Truncation now + deferred summary** — rejected: the deferred summary still re-reads the full session history uncached, so total cost exceeds the single-summary path while adding a two-step flow.
