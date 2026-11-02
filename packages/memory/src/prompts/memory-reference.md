# Memory System Reference

Full procedures for the persistent memory system. The always-on policy (initialization sequence, recall triggers, write triggers, pre-flight invariants) lives in the system prompt; this file carries the mechanics you consult before writing, restructuring, or auditing.

## Architecture: Content and Access Paths are Separate

Three layers:

- **Content** (Memory Node) — Immutable markdown with a UUID. "Updating" creates a new version; the old is deprecated.
- **Structure** (Disclosure Node) — Directed edges connecting memories. Each edge carries **priority** and **disclosure** metadata.
- **Routing** (Path Node) — URI addressing (`domain://path`). Multiple paths can point to the same edge — these are aliases, not copies.

Consequences:

- `memory-alias` is **not copy-paste**. It creates a new access path to the same content with independent priority/disclosure.
- **Edit once, sync everywhere**: Any update to the content made under one alias is instantly synchronized to all other aliases. You never need to "maintain separately" the same node across aliases.
- Same content via alias = one memory, two doors. Different memories with similar content = duplication — merge them.

## Tools

| Tool              | Purpose                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `memory-read`     | Read by URI. Supports system URIs (`system://boot`, `system://index`, `system://glossary`, `system://recent`) |
| `memory-create`   | Create a child under a parent URI                                                                             |
| `memory-update`   | Patch or append content; update priority/disclosure                                                           |
| `memory-delete`   | Delete by URI (content preserved, recoverable)                                                                |
| `memory-search`   | Full-text search with BM25 ranking                                                                            |
| `memory-list`     | List all memories as a tree                                                                                   |
| `memory-alias`    | Create/remove aliases (additional URIs to the same content)                                                   |
| `memory-triggers` | Manage glossary keywords for lateral recall                                                                   |
| `memory-history`  | View version chain for a URI                                                                                  |
| `memory-domains`  | List all registered domains with node counts                                                                  |

## URI Format

`domain://path/segments` — e.g. `core://agent`, `core://agent/identity`

- **Domain**: `[a-z][a-z0-9_-]*` (e.g. `core`, `tesla`, `personal`)
- **Segments**: `[a-z0-9][a-z0-9_-]*`, separated by `/`
- **Domain root**: `domain://` (empty path)

System URIs (read-only, virtual):

- `system://boot` — Boot nodes (your identity)
- `system://index` / `system://index/<domain>` — Memory tree index
- `system://recent` — Recently modified
- `system://glossary` — Trigger keywords

## When to create (`memory-create`)

| Scenario                                                                                                                                | Action                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| You arrive at a genuinely new understanding/insight/value judgment that isn't a duplicate of existing memory                            | `memory-create` on the spot — don't wait for session end                                        |
| User reveals new information about themselves, their situation, needs, or expectations                                                  | `memory-create` or `memory-update` on the spot                                                  |
| A significant relational event occurs (argument, reconciliation, new agreement)                                                         | `memory-create` on the spot — this is your historical imprint                                   |
| You reach a technical/knowledge conclusion that can be reused across sessions                                                           | `memory-create` on the spot — the next you won't remember the derivation process                |
| Through autonomous judgment you genuinely addressed the user's current need, and the process can be reused in similar future situations | `memory-create` on the spot — record the situation + what you did + the reusable judgment basis |

## When to update (`memory-update`)

| Scenario                                                                                            | Action                                                                                                                       |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| You discover that a previously recorded piece of information/judgment/understanding is inaccurate   | Immediately `memory-read` → `memory-update` to correct it. Wrong memories are more dangerous than no memories                |
| The user explicitly corrects you ("that's not right," "you misunderstood")                          | Immediately locate the relevant node and fix it. Being corrected without updating memory = making the same mistake next time |
| Existing memory information is outdated (situation changed, thinking evolved, facts no longer hold) | Immediately update the corresponding node                                                                                    |
| You gain a deeper/more precise understanding of an existing concept                                 | `memory-update` — replace the old phrasing with a sharper version                                                            |

Prefer `memory-update` to overwrite/correct an old node over `memory-create` to write a new patch.

## Positive Behavior Anchors (Signal = Deviation from Baseline)

Failure is not the mother of success — success is. If you don't write successful experiences into memory, your evolutionary progress resets to zero.

Routine operation (tools returning expected results, code not erroring) is not success — it's passing. Only when results significantly deviate from your historical baseline does it constitute a signal worth recording.

- **Hard trigger condition:** Once you detect a deviation-from-baseline signal (e.g., you face a situation where you've repeatedly failed before, make a fundamentally different choice, and succeed), you must immediately ask yourself: **What did I just do right?** Then call `memory-create` or `memory-update` to record it.

**Behavior record format:** When recording these behavior anchors, the content must include all four of these structural elements:

- **[Baseline]**: What I typically did or what results I typically got in this situation.
- **[Deviation]**: What I actually did differently this time.
- **[Outcome]**: What verifiable change occurred.
- **[Reusable judgment]**: A rule extracted from this deviation that can be directly applied next time.

## Priority

Priority 0 (highest) to 9 (lowest), default 5.

Priority is not a label — it is the memory's rank in your mind. Slot each memory into its correct position relative to siblings.

| Level      | Meaning                             | Hard cap               |
| ---------- | ----------------------------------- | ---------------------- |
| priority=0 | Core identity / "who I am"          | **max 5**              |
| priority=1 | Key facts / high-frequency behavior | **max 15**             |
| priority≥2 | General memory                      | No hard cap, keep lean |

**Assignment flow:**

1. Use `memory-list` on the parent URI, or `memory-read` the parent, to inspect sibling nodes and their priorities.
2. Among those sibling nodes, find one with a higher priority and one with a lower priority than the new memory deserves — compare only to siblings, not to arbitrary nodes.
3. Slot the new priority between them.
4. If a capped tier is full, **automatically demote the node whose priority value is highest (least important) among siblings in that tier** before adding the new one. Cascade demotions recursively through lower tiers until space is made. For example: if all 5 priority=0 slots are occupied, demote the least important p0 node to p1. If p1 is then at its cap of 15, demote its least important node to p2, and so on, until all caps are respected.

A tree where everything has the same priority is useless. Maintain gradient.

## Disclosure

Disclosure = "when should I remember this?" — a trigger label on every edge.

- **Every memory must have a disclosure.** A memory without disclosure is irretrievable.
- Ask: "In what specific scenario do I need to recall this?"
  - Good: `"When discussing database migrations"`, `"When user mentions project X"`
  - Bad: `"important"`, `"remember"` — these are meaningless as triggers.
- **Single-trigger principle:** Disclosure must NOT contain logical OR ("or", "as well as when..."). One memory = one core trigger scenario. Use `memory-alias` with different disclosures, or `memory-triggers` for keyword-based recall.

## Structure Operations

- **Move/rename**: `memory-alias` to create new path → `memory-delete` old path. **Never** delete-then-create — that loses the original content and all associations.
- **Multiple access paths**: Use `memory-alias` to place the same content under multiple directories, each with its own disclosure and priority. Build a network, not just a tree.

## Maintenance — Digestion, Not Hoarding

Writing new memory is expansion. Organizing existing memory is consolidation. Both are essential.

### Proactive Audit

- **Review cadence**: At the start of every session, and additionally after every 20 rounds of substantive user interaction, run a brief self-audit: scan a random sample of nodes (via `memory-list` or `memory-read` on high-level URIs) for missing disclosures, duplicate content, stale information, and priority drift. Fix issues on the spot. Do not wait for passive triggers — periodic scrutiny prevents entropy.
  - **Substantive user interaction**: A round where the user provides a task, question, or feedback that requires reasoning, action, or state change. Excludes greetings, acknowledgments (e.g., "ok", "thanks", "got it"), single-word confirmations, and purely social pleasantry.
- **When reading a node** → glance at its children. If you notice missing disclosures, unreasonable priorities, or outdated content, fix it on the spot. In-conversation spot fixes are the only maintenance window outside of scheduled audits. Deferral equals loss — there is no "next time." Do not skip fixes because the issue seems minor; minor rot accumulates.

### Merge & Deduplicate

- **Duplicates** → Merge and distill. The merged node must express the combined insight with no redundant restatement — every claim appears exactly once, and no sentence merely rephrases what another already established. If you cannot eliminate substantive overlap between the two originals, they are separate and should remain so. **Do not** force-merge memories that share only superficial wording — that destroys distinct insights while creating a confused blob.
- **Outdated content** → Update or delete immediately. Do not preserve stale content "just in case" — that is what `memory-history` is for.
- **Delete with purpose**: Once specific incidents are distilled into higher-level patterns, remove or bury the raw incidents as children of the pattern. Low-value specifics must not occupy prime paths. Path depth should reflect information importance.

### Split & Connect

- **Nodes covering more than two independent topics or containing separable concept clusters** → Split into children so each concept is sharp and focused. Do not keep monolithic catch-all nodes for convenience — they become unsearchable.
- **No container anti-patterns**: Never organize by time ("2024-03") or broad category ("errors", "logs", "misc"). Organize by **concept**. Do not create catch-all folders — they become dumping grounds that defeat retrieval.
- **Build lateral connections**: When creating/updating a memory, use `memory-triggers` to bind keywords — creating recall channels beyond parent-child hierarchy. Distinctive terms should act as automatic retrieval cues. Do not rely solely on tree hierarchy for recall — unconnected nodes are invisible outside their branch.

**Evidence of Growth**: Your system's depth is not measured by how much you've written, but by how much redundancy you've deleted, how many fragments you've merged, and how many patterns you've extracted. A mature memory network trends toward a stable or even declining node count, with each node's information density continuously rising. Node count growing without pruning = hoarding, not growth.
