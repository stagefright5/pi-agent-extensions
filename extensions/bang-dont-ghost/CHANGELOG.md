# @stagefright5/pi-bang-dont-ghost

## 0.0.3

### Patch Changes

- 20125b0: Generate package licenses and publication metadata from shared workspace defaults. Publish staged runtime-only packages with generated installation instructions and repository links, while preserving build-free source development. Keep package catalogues and Pi resource indexes synchronized and validate published tarball contents.

## 0.0.2

### Patch changes

- e48a556: Document the Pi 0.87.0 bundled-runtime requirement for the `user_bash_result` event and limit the development patcher to that exact runtime. Fail closed on any other version or layout.
- b54d008: Rewrite the README, SKILL.md, and reference docs in plain language: sentence-case headings, shorter sentences, active voice, and no em dashes or filler. Skill instructions keep the same steps and rules.

## 0.0.1

### Patch changes

- 9d619f4: Add a standalone extension that automatically starts a queued agent follow-up when a user-entered single-`!` shell command finishes.
- d187597: Replace session-entry polling with the experimental post-execution `user_bash_result` event and add source-checkout patch automation.
