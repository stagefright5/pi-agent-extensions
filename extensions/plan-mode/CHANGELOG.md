# @stagefright5/pi-plan-mode

## 0.3.0

### Minor Changes

- e6f91bf: Plan review, diff, summary, and Q&A open in the shared pi-dialog popup: a framed card with the kind, title, iteration, and scroll position in its border and a drop shadow. The revision editor and the summary spinner use matching popups. Keys, mouse selection, copy, and cancellation are unchanged.

## 0.2.0

### Changed

- Rebuild review, diff, summary, and Q&A views on public TUI APIs. Use one panel color, an inset document, scroll position, and a highlighted approval action.
- Show line and character counts and the current section while `plan_output` streams.
- Activate the planning tool only in plan mode and reconstruct plan state from the current branch's messages and tool results.
- Shorten planning and summary prompts without removing approval or revision rules.

### Fixed

- Serialize transactional saves and support cancellation. Store new plans under the configured agent directory while retaining saved paths and legacy snapshots.
- Keep legacy restoration read-only until new activity.
- Guard delayed notifications against retired sessions, preserve reported summary usage during cancellation, and bound shutdown draining.
- Skip unconfigured summaries when there is no current model. Record UI-summary usage separately for the status bar.
- Preserve the tool background behind truncated plan titles.

## 0.1.2

### Patch changes

- 20125b0: Generate package licenses and publication metadata from shared workspace defaults. Publish staged runtime-only packages with generated installation instructions and repository links, while preserving build-free source development. Keep package catalogues and Pi resource indexes synchronized and validate published tarball contents.

## 0.1.1

### Patch changes

- b54d008: Rewrite the README, SKILL.md, and reference docs in plain language: sentence-case headings, shorter sentences, active voice, and no em dashes or filler. Skill instructions keep the same steps and rules.
