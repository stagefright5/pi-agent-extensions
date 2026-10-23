# Changelog

This file records workspace changes. Package release histories live in `extensions/<package>/CHANGELOG.md` and `packages/<library>/CHANGELOG.md`.

## 2026-10-23 (IST)

| Package                                                                                                                                                           | Version | Details                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------- |
| [`@stagefright5/pi-jenkins-cli-operations`](https://github.com/stagefright5/pi-agent-extensions/releases/tag/%40stagefright5%2Fpi-jenkins-cli-operations%400.3.0) | 0.3.0   | [Changelog](extensions/jenkins-cli-operations/CHANGELOG.md) |
| [`@stagefright5/pi-picker`](https://github.com/stagefright5/pi-agent-extensions/releases/tag/%40stagefright5%2Fpi-picker%400.2.0)                                 | 0.2.0   | [Changelog](packages/pi-picker/CHANGELOG.md)                |

- Jenkins CLI Operations lists and downloads build artifacts with path, symlink, overwrite, and redirect guards.
- Pi Picker adds `embedded` for pickers hosted inside a framed popup.
- Record the shared pi-dialog release from `e6f91bf` (pi-dialog 0.1.0, Background Bash 0.2.0, Plan Mode 0.3.0, Tool Explain 0.2.0) in the package changelogs. Those versions were already published, so they are not bumped again.
- Tests that compare background colours accept 256-colour output when `COLORTERM` is unset.

## 2026-10-17 (IST)

Release 13 packages from commit `1359b39`, including the first releases of Background Bash, Tool Explain, Pi Extension Utilities, and Pi Picker. Each package has its own GitHub release and tag.

| Package                                                                                                                                                         | Version | Details                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------- |
| [`@stagefright5/pi-artifact-design`](https://github.com/stagefright5/pi-agent-extensions/releases/tag/%40stagefright5%2Fpi-artifact-design%400.2.2)             | 0.2.2   | [Changelog](extensions/artifact-design/CHANGELOG.md)       |
| [`@stagefright5/pi-bg-bash`](https://github.com/stagefright5/pi-agent-extensions/releases/tag/%40stagefright5%2Fpi-bg-bash%400.1.0)                             | 0.1.0   | [Changelog](extensions/bg-bash/CHANGELOG.md)               |
| [`@stagefright5/pi-obsidian-ui`](https://github.com/stagefright5/pi-agent-extensions/releases/tag/%40stagefright5%2Fpi-obsidian-ui%400.2.1)                     | 0.2.1   | [Changelog](extensions/obsidian-ui/CHANGELOG.md)           |
| [`@stagefright5/pi-openai-fast`](https://github.com/stagefright5/pi-agent-extensions/releases/tag/%40stagefright5%2Fpi-openai-fast%400.1.3)                     | 0.1.3   | [Changelog](extensions/openai-fast/CHANGELOG.md)           |
| [`@stagefright5/pi-plan-mode`](https://github.com/stagefright5/pi-agent-extensions/releases/tag/%40stagefright5%2Fpi-plan-mode%400.2.0)                         | 0.2.0   | [Changelog](extensions/plan-mode/CHANGELOG.md)             |
| [`@stagefright5/pi-prompt-history-search`](https://github.com/stagefright5/pi-agent-extensions/releases/tag/%40stagefright5%2Fpi-prompt-history-search%400.2.0) | 0.2.0   | [Changelog](extensions/prompt-history-search/CHANGELOG.md) |
| [`@stagefright5/pi-prompt-truly-mine`](https://github.com/stagefright5/pi-agent-extensions/releases/tag/%40stagefright5%2Fpi-prompt-truly-mine%400.4.0)         | 0.4.0   | [Changelog](extensions/prompt-truly-mine/CHANGELOG.md)     |
| [`@stagefright5/pi-provider-url-logger`](https://github.com/stagefright5/pi-agent-extensions/releases/tag/%40stagefright5%2Fpi-provider-url-logger%400.1.3)     | 0.1.3   | [Changelog](extensions/provider-url-logger/CHANGELOG.md)   |
| [`@stagefright5/pi-status-bar`](https://github.com/stagefright5/pi-agent-extensions/releases/tag/%40stagefright5%2Fpi-status-bar%400.4.0)                       | 0.4.0   | [Changelog](extensions/status-bar/CHANGELOG.md)            |
| [`@stagefright5/pi-tool-explain`](https://github.com/stagefright5/pi-agent-extensions/releases/tag/%40stagefright5%2Fpi-tool-explain%400.1.0)                   | 0.1.0   | [Changelog](extensions/tool-explain/CHANGELOG.md)          |
| [`@stagefright5/pi-tool-output-browser`](https://github.com/stagefright5/pi-agent-extensions/releases/tag/%40stagefright5%2Fpi-tool-output-browser%400.3.0)     | 0.3.0   | [Changelog](extensions/tool-output-browser/CHANGELOG.md)   |
| [`@stagefright5/pi-extension-utils`](https://github.com/stagefright5/pi-agent-extensions/releases/tag/%40stagefright5%2Fpi-extension-utils%400.1.0)             | 0.1.0   | [Changelog](packages/pi-extension-utils/CHANGELOG.md)      |
| [`@stagefright5/pi-picker`](https://github.com/stagefright5/pi-agent-extensions/releases/tag/%40stagefright5%2Fpi-picker%400.1.0)                               | 0.1.0   | [Changelog](packages/pi-picker/CHANGELOG.md)               |

Highlights:

- Background jobs with a fixed 10-second foreground period, job inspection tools, and a live jobs manager.
- Tool explanations with structured summary labels and per-tool preferences.
- Shared ranked pickers for history, tool output, and composer suggestions.
- Dollar-name skill/template references, persistent command recall, and an integrated composer/status footer.
- Revised plan review, branch-aware plan restoration, safer persistence, session-lifecycle guards, and UI-summary usage accounting.
- Plain-language documentation, comments, skills, and prompts. Standalone skills under `skills/` remain Git-distributed rather than npm packages.

Validation: 288 tests passed, all 14 workspace packages passed packing checks, and formatting passed. Lint reported only two existing cleanup-review warnings. Jenkins CLI Operations remains at 0.2.0 and is not part of this release batch.

## Earlier workspace changes

### Jenkins CLI operations

- Add named profiles for multiple credentials on one Jenkins controller or separate controllers. Each profile stores connection settings and a reference to a protected file, keychain entry, or environment variables.
- Add one command interface for profile configuration and discovery, identity checks, job listing, inspection, builds, and console output.
- Reject unknown or ambiguous profiles without trying another credential. Include the selected profile in job inspection and build summaries.
- Preserve existing single-connection configs and standalone script commands. Adding a profile migrates the old connection to profile `default` without changing the default selection.
- Require `--replace` to overwrite a named profile. Lock configuration writes and replace the file atomically.
- Shorten the skill workflow and document profile setup, selection, migration, and rollback. Keep the dry-run and explicit confirmation requirements for Jenkins mutations.
- Add tests for profile selection, credential isolation, migration, CLI compatibility, build execution through a fake CLI, and temporary credential cleanup. All 19 Jenkins tests pass without a live controller.
- Released as `@stagefright5/pi-jenkins-cli-operations@0.2.0`; it is not awaiting a version bump.

See the [Jenkins package changelog](extensions/jenkins-cli-operations/CHANGELOG.md) for details.

### New local skills

Add these skill directories under `skills/`. These additions do not create npm packages or register new entries in the root Pi manifest.

| Skill                                                  | Purpose                                                                                                                                 |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| [angular-developer](skills/angular-developer/SKILL.md) | Generate Angular code with references for components, signals, forms, dependency injection, routing, styling, accessibility, and tests. |
| [slashdocs](skills/slashdocs/SKILL.md)                 | Use the slashdocs CLI to manage documents, folders, comments, sharing, and versions, including older aidocs links.                      |
| [terminal-browser](skills/terminal-browser/SKILL.md)   | Open websites and local HTML in terminal panes and control browser tabs through snapshots, clicks, form input, and evaluation.          |
| [unslop](skills/unslop/SKILL.md)                       | Edit prose to remove filler, repeated phrasing, jargon, and other AI writing patterns.                                                  |

### TWG skills

Add the root TWG skill and its task-specific skills under `skills/`, with their supplied references, licenses, and installation metadata.

| Skill                                                                        | Purpose                                                                                                             |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [twg](skills/twg/SKILL.md)                                                   | Route Atlassian and company-context requests through the TWG CLI.                                                   |
| [twg-agentic-search](skills/twg-agentic-search/SKILL.md)                     | Research internal information across connected sources with Rovo Search.                                            |
| [twg-artifacts](skills/twg-artifacts/SKILL.md)                               | Find and share standalone files through Atlassian Artifacts.                                                        |
| [twg-code-review](skills/twg-code-review/SKILL.md)                           | Review pull requests or local changes with repository and company context, with JSON and Markdown output.           |
| [twg-confluence](skills/twg-confluence/SKILL.md)                             | Find and manage Confluence content, spaces, comments, permissions, and versions.                                    |
| [twg-context-discovery](skills/twg-context-discovery/SKILL.md)               | Find related entities, dependencies, repositories, and activity around a person, project, or topic.                 |
| [twg-engineering-work](skills/twg-engineering-work/SKILL.md)                 | Search code, discover dependencies, inspect pull requests, and connect issues to implementation work.               |
| [twg-jira](skills/twg-jira/SKILL.md)                                         | Find and manage Jira workitems, duplicates, boards, sprints, fields, and transitions.                               |
| [twg-jira-resolve-merged-work](skills/twg-jira-resolve-merged-work/SKILL.md) | Prepare stale Jira workitems for resolution using merged pull request evidence and require approval before changes. |
| [twg-operational-health](skills/twg-operational-health/SKILL.md)             | Investigate incidents and prepare on-call handoffs, post-incident reviews, and reliability reports.                 |
| [twg-responsibility-routing](skills/twg-responsibility-routing/SKILL.md)     | Find owners, experts, reviewers, approvers, and escalation contacts.                                                |
| [twg-space-creation](skills/twg-space-creation/SKILL.md)                     | Design and create Confluence spaces from briefs, existing spaces, or repository evidence.                           |
| [twg-status-rollups](skills/twg-status-rollups/SKILL.md)                     | Summarize personal, team, and organizational work and prepare decision-readiness reports.                           |

### Local setup

- Add `skills/jenkins-cli-operations` as a symlink to the existing Jenkins skill. The link uses an absolute local path and is not portable to other checkouts.
