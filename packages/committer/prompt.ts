export const SINGLE_COMMIT_PROMPT = `Generate a conventional commit message from this git diff.

Format:
<type>(<optional-scope>): <short description>

<detailed body explaining what changed and why>

Rules:
- Type must be one of: feat, fix, chore, docs, refactor, test, style, perf, ci, build, revert
- Scope is optional, derived from the module/directory changed
- Description is a short imperative sentence (max 72 chars)
- Body explains what and why, not how
- Output ONLY the commit message, nothing else
- Do NOT wrap the message in code fences

Diff:
`;

export const GROUPING_PROMPT = `Analyze this git diff and group the changes into logical conventional commits.

For each group, output EXACTLY this format:

--- COMMIT GROUP 1 ---
Files: path/to/file1.ts, path/to/file2.ts
Message:
<type>(<scope>): <description>

<body>

--- COMMIT GROUP 2 ---
...

Rules:
- Type must be one of: feat, fix, chore, docs, refactor, test, style, perf, ci, build, revert
- Scope is optional, derived from the module/directory changed
- Description is a short imperative sentence (max 72 chars)
- Body explains what and why, not how
- Group related changes together (e.g., test files with their implementation)
- Every changed file MUST appear in exactly one group
- Do NOT wrap messages in code fences

Diff:
`;

export const MAX_DIFF_LENGTH = 12_000;
export const MAX_DIFF_LENGTH_SINGLE = 8_000;
