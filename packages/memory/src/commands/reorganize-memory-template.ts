/**
 * `/reorganize-memory` user-message template.
 */

export const REORGANIZE_MEMORY_TEMPLATE = `Perform a comprehensive audit and reorganization of the entire memory tree.

## Arguments

"$ARGUMENTS" — optional scope restriction (e.g., \`/reorganize-memory tesla://\`). If provided, focus on that domain or subtree. Otherwise, audit everything.

## Step 1: Full inventory

Read the complete memory tree:
1. \`memory-read("system://index")\` to get the tree structure
2. \`memory-read\` every leaf and parent node to see full content, priority, disclosure, and children
3. \`memory-read("system://glossary")\` to review lateral connections

Build a mental model of every node — its content, where it sits, and what it relates to.

## Step 2: Structural analysis

Evaluate each node against these criteria:

### Domain placement
- \`core://\` is exclusively for identity (agent, user). Everything else belongs in \`personal://\` or a domain-specific namespace.
- Ask: "Is this about who I am, or about what I know?" If the latter, it doesn't belong in \`core://\`.

### Parent relationships
- Every child must be conceptually subordinate to its parent. A child about topic X under a parent about topic Y is a smell.
- Ask: "Would I look for this node by navigating to its parent first?" If not, the parent is wrong.

### Conceptual grouping
- 3+ sibling nodes about the same concept should share a parent node with a brief overview.
- Standalone nodes that are the only representative of their topic are fine as top-level.

### Priority gradient
- Siblings at the same priority level reduce the signal. Maintain gradient — more important siblings get lower numbers.
- p0: max 5 (identity only). p1: max 15 (high-frequency). p2+: general knowledge.

### Disclosure quality
- Every node must have a disclosure. Missing or vague disclosures ("important", "remember") are bugs.
- Disclosures must be single-trigger — no "or" / "as well as when".

### Glossary coverage
- Nodes with distinctive terms in their content should have matching glossary triggers.
- Orphaned triggers (pointing to deleted/moved nodes) are bugs.

Present findings as a table:

| Node URI | Issue | Proposed fix |
|----------|-------|-------------|
| ... | Wrong domain | Move to personal://... |
| ... | Bad parent | Reparent under ... |
| ... | Missing grouping | Create parent, move 3 siblings |
| ... | Stale disclosure | Update disclosure text |
| ... | Missing triggers | Add keywords: ... |
| ... | Duplicate content | Merge into ... |

## Step 3: Execute reorganization

Apply changes in safe order:

1. **Create** new parent nodes first (so targets exist for moves)
2. **Create** new child nodes at target locations (copy content from source)
3. **Delete** old paths only after new paths are confirmed
4. **Re-register glossary triggers** on new paths (triggers are bound to memory UUIDs — new nodes need fresh triggers)
5. **Update** disclosures and priorities via \`memory-update\`
6. **Merge** duplicate nodes: distill into one denser node, delete the weaker one

### Move protocol

Moving a node = create-then-delete (not alias, which may hit constraint errors):
1. \`memory-create\` under the new parent with the same content, priority, and disclosure
2. \`memory-delete\` the old path
3. \`memory-triggers\` on the new URI to re-register keywords

Never delete before creating — that loses the content.

## Step 4: Verify

After all changes:
1. \`memory-read("system://index")\` to confirm the final tree
2. Verify \`core://\` has only identity nodes
3. Verify no orphaned nodes or broken parent chains
4. Report a before/after summary

## Principles

- Organize by **concept**, never by time or broad category
- Path depth reflects importance — high-value knowledge at shallow paths
- Every parent node should have meaningful content, not just be a category label
- A mature memory network has stable or declining node count with rising density per node
- When in doubt, fewer deeper trees beat many flat siblings`;

const EMPTY_ARGS_PHRASE = "none — audit the entire memory tree";

export function buildReorganizeMemoryPrompt(args: string): string {
  const trimmed = args.trim();
  const argumentsLine = trimmed === "" ? EMPTY_ARGS_PHRASE : trimmed;
  return REORGANIZE_MEMORY_TEMPLATE.replace("$ARGUMENTS", argumentsLine);
}
