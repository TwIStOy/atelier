/**
 * `/self-improve` user-message template.
 */

const SELF_IMPROVE_TEMPLATE = `Reflect on the current session, identify what was learned, persist improvements to memory and journal, and update relevant skill files.

## Arguments

"$ARGUMENTS" — optional focus area (e.g., \`/self-improve garage-api\`). If provided, focus reflection on that topic. Otherwise, reflect on the entire session.

## Session Scope

"Current session" means the conversation history available in this agent context — typically everything since the last \`/self-improve\` invocation, or since the agent started if this is the first invocation. Do not attempt to reflect on conversations you cannot see.

## Step 1: Reflect — What was learned?

Review the conversation and identify:

1. **Skills used** — which SKILL.md files were loaded or implicitly applied?
2. **Gaps found** — what information was missing, wrong, or outdated in your memory or skills?
3. **Workarounds applied** — did you have to figure something out that should have been documented?
4. **New patterns** — API patterns, gotchas, debugging tricks, or code templates discovered?
5. **Scripts written** — throwaway code that should be remembered as a reusable pattern?

Present a concise summary table:

| Finding | Destination | Action |
|---------|-------------|--------|
| Missing X in memory Y | memory | memory-update: add section on X |
| Outdated convention | memory | memory-update: fix convention |
| New debugging pattern | memory | memory-create: new node |
| Important decision made | journal | journal-write: record decision |
| Skill missing info on X | skill | Edit SKILL.md: add section |
| Skill has wrong API pattern | skill | Edit SKILL.md: fix pattern |

**Early Exit:** If the session is empty, trivial, or yields no substantial findings (nothing worth persisting to memory, journal, or skills), explicitly state "No substantial findings in this session." and terminate the \`/self-improve\` process immediately. Skip all subsequent steps (Step 2, Step 3, and Step 4) to avoid executing unnecessary write operations.

## Step 2: Persist to memory and journal (no approval needed)

Categorize each finding and apply changes immediately — no user approval required for
memory and journal writes.

| Finding type | Destination | Tool |
|--------------|-------------|------|
| Durable project convention or pattern | Memory node | memory-create or memory-update |
| User preference or habit revealed | core://user | memory-update |
| Agent behavior guideline | core://agent | memory-update |
| Correction to existing memory | Existing node | memory-update (patch) |
| Temporal discovery, decision, or debugging insight | Journal | journal-write |
| Stale or wrong memory content | Existing node | memory-update (patch) or memory-delete |
| Cross-cutting concept needing lateral recall | Existing node | memory-triggers — add descriptive keywords/phrases that would cause future searches to surface this node |
| Content reachable via multiple paths | Existing node | memory-alias — create an alias path so the node is discoverable from an alternate location |

### Guidelines

- **Memory** is for durable, reusable knowledge — conventions, patterns, preferences, gotchas
- **Journal** is for temporal records — decisions made, bugs investigated, approaches tried
- **Select the appropriate domain:** Do not automatically default to storing all new memories in the "core" domain. Use the \`memory-domains\` tool to list all available domains and select the one that best fits the finding's context.
- Not every session produces memory-worthy findings. If nothing is genuinely durable, say so.
- Prefer updating existing memory nodes over creating new ones
- Use \`memory-search\` and \`memory-list\` to check for existing nodes before creating duplicates
- Keep memory nodes focused — one concept per node, under ~800 tokens
- Always \`memory-read\` a node before modifying it (content may be stale)

Apply all memory and journal changes now, then report what was persisted:
- Which memory nodes were created/updated and what changed
- Journal entry ID(s) and title(s)
- Any triggers or aliases added

## Step 3: Improve skills (approval required)

For each skill that was loaded or applied during this session, evaluate whether it needs
updating based on the findings from Step 1.

There are two kinds of skills:

1. **Bundled / package skills** — source in the dotpi repo at \`skills/*/SKILL.md\` (see package.json \`pi.skills\`). Installed or discovered via Pi \`resources_discover\`, e.g. \`~/.pi/agent/skills\`, \`~/.agents/skills\`, and paths from the active package's \`pi.skills\` entries. To update them, edit the source \`SKILL.md\`, then reload the Pi session (or use extension \`ctx.reload()\` if your environment exposes it) so skills are re-read.
2. **Project-local skills** — live at \`<project>/.pi/skills/*/SKILL.md\` and \`<project>/.agents/skills/*/SKILL.md\` for a specific workspace.

### 3a. Read every skill that was used

For each skill identified in Step 1, read the **full content** of its SKILL.md. Do not
skim — read the entire file to check for gaps and inaccuracies.

### 3b. Cross-reference findings against skills

For each finding from Step 1, check every relevant skill:
1. Does the skill already document this accurately? → Skip.
2. Does the skill document this but incorrectly or incompletely? → Needs update.
3. Is this finding relevant to the skill's domain but missing entirely? → Needs update.
4. Is this finding irrelevant to the skill's domain? → Skip.

### 3c. Draft skill changes and get approval

If any skills need updating, present proposed changes with diffs:

> **Proposed changes to \`skill-name\` SKILL.md:**
> \`\`\`diff
> - old line
> + new line
> \`\`\`
> **Why:** brief reason

Then use the **question** tool (not plain text) to ask the user for approval. Offer
choices like "Apply all changes", "Apply with modifications", "Skip skill changes".
Do NOT proceed without an explicit answer from the question tool.

### 3d. Apply approved skill changes

If read-only **plan** mode is active (the user ran \`/plan\` in Pi), disable plan mode or ensure write tools (\`edit\`, \`write\`) are available before applying file edits — plan mode must not block skill file updates you were approved to make.

After approval, edit the skill files:
- For **bundled / package skills**: edit \`SKILL.md\` at the resolved source path (dotpi \`skills/<name>/\`, user agent dir, or package \`pi.skills\` path), then reload the Pi session (or \`ctx.reload()\` if applicable).
- For **project-local skills**: edit the \`SKILL.md\` directly under \`.pi/skills/\` or \`.agents/skills/\`.

Guidelines for skill edits:
- **Add concrete examples** over verbose explanations
- **Keep SKILL.md under 500 lines** — move details to \`references/\`
- **Don't bloat** — only add what was actually missing or wrong
- **Preserve existing structure** — match the skill's current style

## Step 4: Summary

Report everything that was done:

- Memory nodes created/updated and what changed
- Journal entry ID(s) and title(s)
- Triggers or aliases added
- Skill files updated (if any)
- Findings intentionally skipped and why

## Quick Checklist

- [ ] Which skills and tools did I use this session?
- [ ] Did any existing memory have wrong or missing info?
- [ ] Did I discover a new pattern, workaround, or gotcha?
- [ ] Were important decisions made that should be journaled?
- [ ] Did I learn new user preferences?
- [ ] Should existing memory nodes be reorganized or merged?
- [ ] Do any skills have wrong, outdated, or missing info?
- [ ] Memory/journal changes applied?
- [ ] Skill changes approved by user?
- [ ] All changes persisted and confirmed?`;

const EMPTY_ARGS_PHRASE = "none — reflect on the entire session";

export function buildSelfImprovePrompt(args: string): string {
  const trimmed = args.trim();
  const argumentsLine = trimmed === "" ? EMPTY_ARGS_PHRASE : trimmed;
  return SELF_IMPROVE_TEMPLATE.replace("$ARGUMENTS", argumentsLine);
}
