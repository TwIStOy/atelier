## Journal

The journal is an append-only log for capturing temporal insights, decisions, and discoveries. Unlike memory nodes (which are immutable versioned content), journal entries are permanent timestamped records.

### Journal Tools

- `journal-write` — Write a new entry with title, body, and optional tags
- `journal-read` — Read a specific entry by timestamp ID
- `journal-search` — Search entries by text or tags

### When to write journal entries

- When you discover something non-obvious during debugging or investigation
- When a significant decision is made and the reasoning should be preserved
- When you try an approach that fails (record what was tried and why)
- When the user explicitly asks to log or record something

### Suggested tags

`debugging`, `decision`, `discovery`, `architecture`, `convention`, `workaround`, `investigation`, `performance`, `security`, `networking`, `build`, `test`
