---
name: write-a-skill
description: Create and refine agent skills with proper structure, progressive disclosure, and bundled resources. Use when user wants to create, write, build, or refine a skill.
---

# Writing Skills

## Process

1. **Gather requirements** - ask user about:
   - What task/domain does the skill cover?
   - What specific use cases should it handle?
   - Does it need executable scripts or just instructions?
   - Any reference materials to include?

2. **Draft the skill** - create:
   - SKILL.md with concise instructions
   - Additional reference files if content exceeds 500 lines
   - Utility scripts if deterministic operations needed

3. **Review with user** - present draft and ask:
   - Does this cover your use cases?
   - Anything missing or unclear?
   - Should any section be more/less detailed?

## Skill Structure

```
skill-name/
├── SKILL.md              # Main instructions (required)
├── references/           # Split reference docs (if needed)
│   ├── TOPIC_A.md        # Each file covers one topic
│   └── TOPIC_B.md
└── scripts/              # Utility scripts (if needed)
    └── helper.js
```

Prefer a `references/` folder with multiple focused files over a single monolithic file. Each reference file should cover one distinct topic (e.g. `CALLOUTS.md`, `EMBEDS.md`, `PROPERTIES.md`). This keeps individual files scannable and lets the agent load only what's relevant.

## SKILL.md Template

```md
---
name: skill-name
description: Brief description of capability. Use when [specific triggers].
---

# Skill Name

## Quick start

[Minimal working example]

## Workflows

[Step-by-step processes with checklists for complex tasks]

## Advanced features

[Link to split references: See [Topic A](references/TOPIC_A.md), [Topic B](references/TOPIC_B.md)]
```

## Description Requirements

The description is **the only thing your agent sees** when deciding which skill to load. It's surfaced in the system prompt alongside all other installed skills. Your agent reads these descriptions and picks the relevant skill based on the user's request.

**Goal**: Give your agent just enough info to know:

1. What capability this skill provides
2. When/why to trigger it (specific keywords, contexts, file types)

**Format**:

- Max 1024 chars
- Write in third person
- First sentence: what it does
- Second sentence: "Use when [specific triggers]"

**Good example**:

```
Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when user mentions PDFs, forms, or document extraction.
```

**Bad example**:

```
Helps with documents.
```

The bad example gives your agent no way to distinguish this from other document skills.

## When to Add Scripts

Add utility scripts when:

- Operation is deterministic (validation, formatting)
- Same code would be generated repeatedly
- Errors need explicit handling

Scripts save tokens and improve reliability vs generated code.

## When to Split into References

Create `references/` with split files when:

- SKILL.md exceeds 100 lines
- Content has distinct domains (e.g. `CALLOUTS.md` vs `EMBEDS.md`)
- Advanced features are rarely needed
- A single reference file would exceed 200 lines

Each file in `references/` should:

- Cover **one** topic or domain
- Be self-contained (readable without loading other reference files)
- Have a descriptive, ALL_CAPS file name matching its topic

## Skill Qualities & Vocabulary

Once structure is right, refine a skill's *behaviour* with the vocabulary of predictability: leading words, context pointers, completion criteria, the two invocation loads, and named failure modes. See [Skill Vocabulary & Qualities](references/SKILL_VOCABULARY.md).

## Review Checklist

After drafting, verify:

- [ ] Description includes triggers ("Use when...")
- [ ] SKILL.md under 100 lines
- [ ] No time-sensitive info
- [ ] Consistent terminology
- [ ] Concrete examples included
- [ ] References one level deep
- [ ] No no-op lines (each instruction changes behaviour vs the model's default)
- [ ] Prohibitions phrased as positive target behaviours where possible (no elephant-naming)
- [ ] A leading word anchors the core behaviour, or restatements collapsed into one
