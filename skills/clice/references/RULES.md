# clice.toml rules

Official reference: https://docs.clice.io/zh/clice/guide/configuration#rules

Schema: `https://docs.clice.io/clice-config.schema.json`. Unknown keys are rejected.

`${workspace}` is the only string variable. It is the project root: the directory of the `clice.toml` that owns the project. It expands in `default_command` and in patterns.

## Where the file applies

Relative patterns and the `default_command` working directory use the config file's directory. `..` is allowed.

The project that serves an open source is the workspace folder that contains `clice.toml` or `compile_commands.json`. A nested directory with its own `clice.toml` is a separate project. The parent does not load it, and its rules do not cover the parent's sources.

## What each field does

- `compile_commands`: a `compile_commands.json`, or a directory that contains one, relative to the config file. Every entry applies to its own file even when `patterns` do not match that file. Patterns and rule order only choose among several entries for one file.
- `default_command`: the command for a matching file that has no database entry, without the source path. A string is split like a shell command; an array is argv. Matching translation units on disk join the background index.
- `append` / `remove`: flags added or dropped for matching files. A later rule's `remove` drops an earlier rule's `append`. `-I*` drops every `-I`. Appending `-I` does not beat an `-I` already earlier on the command. Put the winning include in `default_command` itself.
- `query_toolchain`: clice runs that file's compiler for the target, system headers, and predefined macros. The default is true. Any matching rule set to false wins.
- `index`, `lint`, `format`: any matching rule set to false wins. `index = false` still compiles the file when it is opened.

## Commands

Copy the command from a database entry for the same language. Keep the flags that change how the file is parsed. Drop `-c`, `-o`, and the source path.

Match `*.c`, `*.cc`, `*.cpp`, and `*.cxx`. A header with `default_command` is compiled as its own translation unit. Headers without an entry borrow the translation unit that includes them.

## Portability

Rewrite paths inside the project to `${workspace}/<relative>`. Leave compiler and system paths absolute. `-D` values come from the database entry that supplied the command; regenerate after those flags change.

## Check

`clice inspect hover` prints the resolved header path. `source=Default` means the file used its own command. `source=Borrowed` means it had no command and reused another file. A toolchain line of `succeeded` with `0 failed` means the compiler ran. Missing headers show up as include diagnostics; a null diagnostics array means that file parsed.
