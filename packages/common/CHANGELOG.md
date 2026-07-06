# Changelog

## [Unreleased]

### Added

- `EDITOR_HINT_EVENT` cross-extension channel (`EditorHintPayload`: `source` / `text` / optional `color`) for transient hint messages rendered inside the input editor's border. Producers emit via `pi.events.emit`; the editor-owning extension subscribes and renders the most recent active hint.
- `chainEditorFactory(current, wrap)` and `getEditorFactoryParent(factory)` for layering custom editor factories on Pi's single editor slot without clobbering each other. Each wrapper records its immediate parent so chains compose regardless of registration order.
