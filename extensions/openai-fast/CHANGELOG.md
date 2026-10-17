# @stagefright5/pi-openai-fast

## 0.1.3

### Fixed

- Save overrides in `<agent-dir>/openai-fast.json` using private, atomic writes instead of rewriting Pi's settings.
- Continue reading the legacy `openaiFast` setting when no override exists. Reject malformed saved configuration rather than overwriting it.
- Register the Fast indicator through the shared model-status contract and remove it on session shutdown. Preserve `/fast`, `--fast`, and OpenAI priority-tier behavior.

## 0.1.2

### Patch changes

- Display OpenAI Fast mode as the text-style ⚡︎ glyph immediately after effort in the compact footer, without duplicating the generic extension status. Keep it attached to effort in shortened model labels and remove it when Fast mode is off.

## 0.1.1

### Patch changes

- 20125b0: Generate package licenses and publication metadata from shared workspace defaults. Publish staged runtime-only packages with generated installation instructions and repository links, while preserving build-free source development. Keep package catalogues and Pi resource indexes synchronized and validate published tarball contents.
