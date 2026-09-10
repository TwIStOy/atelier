# tool-display

TUI rendering of tool calls: per-tool adapters, and the layout-time grouping that projects consecutive transcript siblings onto fewer rows.

## Language

**Verb-group**:
A layout-time fold of consecutive non-destructive tool calls into one aggregate summary row. Entries stay independent; each rebuild rescan the chat siblings and projects height and header. Not a merge of transcript messages.
_Avoid_: cluster, fold, collapse (when meaning this layer)

**Truncation**:
A second layout-time fold: leftover collapsed, groupable siblings that verb-group did not claim, hidden behind one header when the participant count exceeds `groupMaxVisible + 1`.
_Avoid_: N more (the header copy, not the layer), overflow

**Flush group**:
A visual packing rule: inside a verb-group or truncation span the gap is 0; a Break sibling forces a blank line on both sides.
_Avoid_: stick, glue, gap_after

**Member**:
A collapsed, non-waiting tool call whose name has an Aggregate Rule. It is claimed by a verb-group and counted in that group's header.
_Avoid_: participant (truncation's count), child

**ThoughtMember**:
A finished, collapsed assistant block with no visible body text. It is claimed by the surrounding verb-group, rendered at height 0, and never appears in the header. Streaming or user-expanded thinking is not this.
_Avoid_: hidden thinking, transparent thinking

**Transparent**:
A sibling that neither joins a group nor breaks it: streaming thinking, user-expanded thinking, user-expanded tools, and zero-line siblings. It keeps its own rows.
_Avoid_: skip, ignore

**Break**:
Anything that ends the current verb-group or truncation span: assistant body text, user prompt, and any tool that is not a Member (bash, edit, write, and unregistered names). Truncation may still claim those tools in its own leftover span.
_Avoid_: interrupt, delimiter

**Aggregate Rule**:
A registration of `toolName → { verb, singular, plural, progressive }` in common. Built-in rules cover `grep`, `glob`, `ls`, and `read`. Other tools join only by registering.
_Avoid_: adapter (display adapters are separate), whitelist

**Group leader**:
The first claimed Member (or truncation participant) of a span. It draws the summary row; later claimed siblings render empty.
_Avoid_: parent, header widget

**Truncation bucket**:
The kind used to phrase a truncation header: bash calls are `commands`; edit, write, and apply_patch are `files`; anything else without an Aggregate Rule is unbucketed (`N more`). With verb-group off, registered names keep their Aggregate Rule phrasing instead of `Ran`/`Edited`.
_Avoid_: Ran/Edited (header copy, not the concept)
