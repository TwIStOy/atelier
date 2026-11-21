---
name: todoist
description: Manage Todoist tasks via the `todoist` CLI tool. Use when the user asks to add, list, modify, close, delete, or filter tasks, or to inspect projects/labels. Covers task CRUD, filtering with Todoist filter syntax, quick add, project and label management, and completed tasks. Triggers on mentions of todoist, tasks, todos, to-do list, or task management via CLI.
---

# Todoist CLI

Interact with Todoist task management through the `todoist` CLI (Go binary, installed at system PATH).

## Prerequisites

The CLI must be configured with an API token (`~/.config/todoist/config.json`). If not configured, the user needs to get their token from `https://app.todoist.com/app/settings/integrations/developer`.

Always run `todoist sync` before operations if data might be stale.

## Command Reference

### list — Show tasks

```bash
todoist list [--filter FILTER] [--priority]
todoist l [-f FILTER] [-p]
```

`--priority` / `-p` sorts by priority. `--filter` / `-f` applies Todoist filter syntax (see references/filters.md).

Output columns: `ID  Priority  DueDate  Project  Labels  Content`

### add — Create a task

```bash
todoist add [options] "Task content"
todoist a [options] "Task content"
```

| Option | Flag | Default | Description |
|--------|------|---------|-------------|
| Priority | `-p VALUE` | 4 (lowest) | 1 (highest) – 4 (no priority) |
| Labels | `-L VALUE` | — | Comma-separated label names |
| Project ID | `-P VALUE` | 0 (Inbox) | Target project ID |
| Project name | `-N VALUE` | — | Target project by name |
| Due date | `-d VALUE` | — | Date string (e.g. `today`, `tomorrow`, `2025/04/02`, `2025/04/02 18:00`) |
| Reminder | `-r` | false | Set reminder (premium only) |

**Priority mapping**: p1 = highest urgency, p4 = no priority. The `-p` flag accepts 1–4.

### modify — Edit a task

```bash
todoist modify [options] <Task ID>
todoist m [options] <Task ID>
```

Same flags as `add` (`-c` for content, `-p`, `-L`, `-P`, `-N`, `-d`).

### close — Complete a task

```bash
todoist close <Task ID>
todoist c <Task ID>
```

### delete — Remove a task

```bash
todoist delete <Task ID>
todoist d <Task ID>
```

### show — Task detail

```bash
todoist show <Task ID>
```

`--browse` / `-o` opens any URL found in the task content.

### quick — Quick add (natural language)

```bash
todoist quick "Task content with natural language date"
todoist q "Buy milk tomorrow p1 #Shopping @groceries"
```

Parses Todoist's natural language syntax inline (project via `#Name`, label via `@label`, priority via `p1`–`p4`, date via natural language). Uses the REST API directly.

### completed-list — Completed tasks

```bash
todoist completed-list [--filter FILTER]
todoist cl [-f FILTER]
```

Premium only. Shows tasks completed in the last 90 days by default.

### projects — List projects

```bash
todoist projects
```

Output: `<ProjectID> #<ProjectName>`

### add-project — Create project

```bash
todoist add-project [options] "Project name"
todoist ap [options] "Project name"
```

| Option | Description |
|--------|-------------|
| `--color VALUE` | Color ID (30–49) |
| `--item-order VALUE` | Sort order index |

### labels — List labels

```bash
todoist labels
```

Output: `<LabelID> @<LabelName>`

### karma — Show karma score

```bash
todoist karma
```

### sync — Refresh local cache

```bash
todoist sync
todoist s
```

## Global Options

| Flag | Description |
|------|-------------|
| `--header` | Print column headers |
| `--color` | Colorize output |
| `--csv` | CSV output format |
| `--debug` | Print debug logs |
| `--namespace` | Show parent task as namespace prefix |
| `--indent` | Indent child tasks |
| `--project-namespace` | Show parent project as namespace prefix |

## Task ID Format

Since v0.23, task and project IDs are **alphanumeric strings** (e.g. `6gHG8mf8HfJ3qgCJ`), not numeric. Always use the full ID from `list` or `show` output.

## Common Workflows

### List overdue high-priority tasks

```bash
todoist list -f '(overdue | today) & p1'
```

### Add a task to a project with a label and due date

```bash
todoist add "Review PR" -p 2 -N Work -L review -d tomorrow
```

### Quick add with natural language

```bash
todoist quick "Call dentist tmr 10am p1"
```

### Complete and verify

```bash
todoist close <Task ID> && todoist list -f 'today'
```

### View urgent tasks

```bash
todoist list -f '(overdue | today) & p1'
```

### View tasks by project

```bash
todoist list -f '#Work'
```

## Filter Syntax

For complete filter syntax reference, see [references/filters.md](references/filters.md).

Key operators: `|` (OR), `&` (AND), `!` (NOT), `()` (grouping).

Quick reference:
- Priority: `p1`, `p2`, `p3`, `p4`
- Project: `#ProjectName`, `##ProjectName` (include sub-projects)
- Label: `@labelName`
- Date: `today`, `tomorrow`, `overdue`, `no date`, `7 days`
- Due: `due before: DATE`, `due after: DATE`, `due: DATE`
- Created: `created: DATE`, `created before: DATE`, `created after: DATE`
