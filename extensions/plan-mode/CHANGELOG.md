# @stagefright5/pi-plan-mode

## 0.2.0

### Minor Changes

- 00fb29b: Align with pi 1.2.0: rebuild plan review on public TUI APIs with cancellable interactions and serialized transactional saves, account for every session usage category, and respect configured agent/session directories. Add strict SDK typechecking and regression coverage for workflow, narrow viewports, mouse dispatch, cancellation, and profile isolation.
- 5e68a6e: Redesign the plan review, diff, summary, and Q&A views as one card: a lighter header band (kind, title, iteration, scroll position, plan path), the document inset on a darker sheet with a scroll thumb, and a footer band with the approve action highlighted and copy/close on the right. The duplicate hint row is gone. The inline plan in the transcript gets a matching header.

### Patch Changes

- 8b0bcc5: Preserve bash output and truncation notices on timeout through the host adapter protocol. Restore accent-colored model statuses and legacy fast-status placement. Guard delayed notifications against retired contexts, retain reported summary usage during cancellation and bounded shutdown draining, keep legacy plan restoration read-only until new activity, silently skip unconfigured summaries without a current model, and avoid indexing repeated tool payloads. Narrow status shims and separate settings helpers from storage.
- 8b0bcc5: Audit fixes for pi 1.3.0: keep prompt-history I/O off submission with cross-process locking; reconstruct plan state from branch messages/results and activate its tool only in plan mode; store extension preferences separately from Pi settings; protect and clean background logs; rotate physical-model logs without blocking requests; account for UI summary costs in the status bar; share status contracts; expose structured/nested tool results; and use erasable TypeScript with centralized host version pins.

  Existing plan snapshots and recorded directories remain readable. Composer shortcuts and dollar-reference behavior, and all-tool explanations by default, are retained intentionally. Summary costs use durable custom usage entries; Pi's native session total cannot include UI-only calls through the public 1.3.0 API.

- 8b3189e: Shorten documentation, remove narration-style comments, and use concrete wording in design guidance, Plan Mode prompts, and artifact validation messages. Preserve approval requirements, command behavior, and compatibility notes. Mark the edited design fundamentals as adapted from upstream rather than verbatim.
- 136386c: Draw the review card in one panel colour with thin rules around the document, so its action bar no longer blends into the composer below. While the agent writes a plan, the `plan_output` row shows line and character counts and the current section.
- 3330a53: Keep the tool box background behind cut tool-row labels. A long `plan_output` title, or a long compact tool header, no longer ends its background where the `…` starts.

## 0.1.2

### Patch changes

- 20125b0: Generate package licenses and publication metadata from shared workspace defaults. Publish staged runtime-only packages with generated installation instructions and repository links, while preserving build-free source development. Keep package catalogues and Pi resource indexes synchronized and validate published tarball contents.

## 0.1.1

### Patch changes

- b54d008: Rewrite the README, SKILL.md, and reference docs in plain language: sentence-case headings, shorter sentences, active voice, and no em dashes or filler. Skill instructions keep the same steps and rules.
