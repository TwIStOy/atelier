---
description: Generate a commit message following this repo's existing commit style
argument-hint: [scope]
---
Generate a commit message for all currently unstaged and uncommitted changes in this project.

## Steps

1. Run `git log --format="%B---" -20` to study the existing commit message style in this repository. Identify the patterns: type prefixes, scope usage, summary line style, body format, bullet style, trailer conventions, etc.
2. Run `git status` to see all changed files. Run `git diff` and `git diff --cached` to understand what changed. If nothing is staged, stage the relevant files first with `git add`.
3. Analyze the changes and draft a commit message that follows the style you observed in step 1.
4. Commit with that message directly WITHOUT asking me.

## Arguments

"$ARGUMENTS" — optional scope hint. If provided, consider using it as the commit scope.
