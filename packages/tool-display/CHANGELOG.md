# Changelog

## [Unreleased]

### Fixed

- Fixed the error icon being repeated on every wrapped line of a tool's error reason when the tool call failed and was expanded. The icon now appears only on the first line, with continuation lines aligned by padding ([#9](https://github.com/TwIStOy/pi-extensions/issues/9)).
- Fixed the Bash tool header truncating the command at a fixed point and dropping the `in <cwd>` suffix. The command now fills the available terminal width and is truncated cleanly so the description and working-directory suffix stay visible ([#8](https://github.com/TwIStOy/pi-extensions/issues/8)).
