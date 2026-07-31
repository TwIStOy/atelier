# Lock-free concurrency via atomicity and derived data

Multiple pi sessions share the personal vault (`~/.llm-wiki/`), yet the extension takes no file locks. This is deliberate and rests on one property: **all generated metadata is derived data**, rebuildable from `raw/**` + `wiki/**` at any time.

The integrity rules instead:

- Every file write goes through tmp-file + atomic rename (no torn writes).
- Source Packet IDs are allocated with `mkdir` (atomically fails if taken; retry with the next sequence number).
- `events.jsonl` is append-only (atomic appends for small writes).
- Concurrent metadata rebuilds may waste work but always converge on the next rebuild.

What this does *not* protect: two sessions editing the same wiki page concurrently (last writer wins). We accept that — page content is agent-mediated and, if the user keeps the vault as a git repo, recoverable. We rejected `proper-lockfile`-style locking because stale-lock recovery after a crashed session is a worse operational burden than a rare wasted rebuild.
