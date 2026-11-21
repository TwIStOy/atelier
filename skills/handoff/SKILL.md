---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up.
disable-model-invocation: true
metadata:
  opencode/autoinvoke: false
---

# Handoff

Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save to the temporary directory of the user's OS - not the current workspace.

Include a "suggested skills" section in the document, naming which skills the next agent should call the Skill tool for.

Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the text typed alongside the invocation is non-empty, treat it as a description of what the next session will focus on and tailor the doc accordingly.
