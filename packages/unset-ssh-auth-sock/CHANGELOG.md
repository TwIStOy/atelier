# Changelog

## [Unreleased]

### Added

- Initial release. On pi startup, removes `SSH_AUTH_SOCK` from the pi process
  environment so that no child process (bash, git over ssh, subagents, ...)
  inherits the host's ssh-agent socket. Prevents the agent from silently
  authenticating ssh / git operations with the user's forwarded agent.
