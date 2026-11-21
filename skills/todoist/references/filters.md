# Todoist Filter Syntax Reference

Complete filter syntax for `todoist list --filter` and `todoist completed-list --filter`.

## Operators

| Symbol | Meaning | Example |
|--------|---------|---------|
| `\|` | OR | `today \| overdue` |
| `&` | AND | `today & p1` |
| `!` | NOT | `!#Work` |
| `()` | Grouping | `(today \| overdue) & #Work` |
| `,` | Separate lists in view | `date: yesterday, today` |

## Priority

| Filter | Meaning |
|--------|---------|
| `p1` | Priority 1 (highest) |
| `p2` | Priority 2 |
| `p3` | Priority 3 |
| `p4` | Priority 4 (no priority) |

## Project & Section

| Filter | Meaning |
|--------|---------|
| `#ProjectName` | Tasks in project |
| `##ProjectName` | Tasks in project and sub-projects |
| `/SectionName` | Tasks in section (across all projects) |
| `#Project & /Section` | Tasks in specific project section |

## Labels

| Filter | Meaning |
|--------|---------|
| `@labelName` | Tasks with label |
| `no labels` | Tasks without any labels |

## Date & Due

| Filter | Meaning |
|--------|---------|
| `today` | Due today |
| `tomorrow` | Due tomorrow |
| `overdue` / `od` | Past due |
| `no date` | No due date |
| `no time` | Has date but no time |
| `7 days` | Due within 7 days |
| `recurring` | Recurring tasks |
| `date: DATE` | Due on specific date |
| `date before: DATE` | Due before date |
| `date after: DATE` | Due after date |
| `due: DATE` | Due on date (considers deadlines) |
| `due before: DATE` | Due before date |
| `due after: DATE` | Due after date |

Date formats: `Jan 3`, `2025/04/02`, `tomorrow`, `next week`, `+4 hours`, `-3 days`, day names (`Monday`, `sat`).

## Deadlines

| Filter | Meaning |
|--------|---------|
| `deadline: DATE` | Deadline on date |
| `no deadline` | No deadline set |
| `deadline before: DATE` | Overdue deadlines |

## Search & Content

| Filter | Meaning |
|--------|---------|
| `search: keyword` | Tasks containing keyword |
| `subtask` | All sub-tasks |
| `!subtask` | Parent tasks only |

## Creation & Assignment

| Filter | Meaning |
|--------|---------|
| `created: DATE` | Created on date |
| `created before: DATE` | Created before date |
| `created after: DATE` | Created after date |
| `assigned` | Assigned to anyone |
| `assigned to: me` | Assigned to you |
| `assigned to: others` | Assigned to others |
| `assigned by: me` | You assigned to others |
| `shared` | In shared projects |

## Workspace

| Filter | Meaning |
|--------|---------|
| `workspace: Name` | Tasks in workspace |
| `##FolderName` | Tasks in folder (sub-projects) |

## CLI Filter Support

The CLI uses a yacc-based parser supporting:
- Boolean operators: `&`, `|`, `!`
- Priority: `p1`–`p4`
- Project: `#Name`, `##Name`
- Label: `@name`
- Date expressions: relative dates, specific dates
- Parentheses for grouping

Note: Some advanced Todoist web filters (wildcards `*`, `workspace:`, `added by:`, `search:`) may not be supported by the CLI parser. Stick to core operators (`&`, `|`, `!`), priority, project, label, and date expressions for reliable results.

## Predefined Filters

| Name | Filter | Description |
|------|--------|-------------|
| Urgent | `(overdue \| today) & p1` | Priority 1 tasks that are overdue or due today |

## Common Filter Examples

```bash
# Overdue or today, high priority
todoist list -f '(overdue | today) & p1'

# Tasks in Work project due this week
todoist list -f '#Work & 7 days'

# Tasks with @email label due today
todoist list -f 'today & @email'

# All p1 and p2 tasks due in next 2 weeks
todoist list -f '(p1 | p2) & 14 days'

# Inbox tasks without a date
todoist list -f '#Inbox & no date'

# Tasks not in Work project due today
todoist list -f 'today & !#Work'

# Overdue tasks with time assigned
todoist list -f 'overdue & !no time'
```
