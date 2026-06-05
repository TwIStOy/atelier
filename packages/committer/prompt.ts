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

Output a JSON array. Each element is an object with:
- "files": array of file paths (strings)
- "message": conventional commit message (string)

Example:
[
  {
    "files": ["src/auth.ts", "src/auth.test.ts"],
    "message": "feat(auth): add token refresh logic\\n\\nAutomatically refreshes JWT tokens 5 minutes before expiry."
  },
  {
    "files": ["README.md"],
    "message": "docs: update auth section in README"
  }
]

Rules:
- Type must be one of: feat, fix, chore, docs, refactor, test, style, perf, ci, build, revert
- Scope is optional, derived from the module/directory changed
- Description is a short imperative sentence (max 72 chars)
- Body explains what and why, not how
- Group related changes together (e.g., test files with their implementation)
- Every changed file MUST appear in exactly one group
- Output ONLY the JSON array, no other text

Changed files:
{changed_files}

Diff:
`;

export const GROUPING_RETRY_PROMPT = `The previous grouping did not cover all files. Please redo the grouping.

All changed files that must be covered:
{changed_files}

Files missing from the previous attempt:
{missing_files}

Previous grouping:
{previous_groups}

Output the corrected JSON array with ALL files covered:
`;

export const MAX_DIFF_LENGTH = 12_000;
export const MAX_DIFF_LENGTH_SINGLE = 8_000;
export const MAX_GROUPING_RETRIES = 3;
