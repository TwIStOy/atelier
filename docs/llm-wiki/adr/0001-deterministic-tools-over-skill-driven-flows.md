# Deterministic tools over skill-driven flows

The wiki's core operations are implemented as deterministic extension tools (zosmaai-style), not as agent discipline taught via SKILL.md (Karpathy-style, and this repo owner's usual preference). A knowledge base lives or dies by its invariants — immutable source packets, consistent generated metadata, stable citations — and agent discipline cannot guarantee those. We accept the cost: changing a workflow means changing code and cutting a release, rather than editing a skill file.

Skill files still coordinate *behavior across* tools (when to ingest, when to file a query answer back, how llm-wiki relates to the memory extension), but the integrity-critical mechanics — capture, packet storage, metadata rebuild, guardrails blocking direct edits to `raw/**` and `meta/**` — live in tools.
