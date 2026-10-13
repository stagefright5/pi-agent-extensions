# Changelog

This file records workspace changes. Published packages keep their release history in `extensions/<package>/CHANGELOG.md`.

## Unreleased

### Jenkins CLI operations

- Add named profiles for multiple credentials on one Jenkins controller or separate controllers. Each profile stores connection settings and a reference to a protected file, keychain entry, or environment variables.
- Add one command interface for profile configuration and discovery, identity checks, job listing, inspection, builds, and console output.
- Reject unknown or ambiguous profiles without trying another credential. Include the selected profile in job inspection and build summaries.
- Preserve existing single-connection configs and standalone script commands. Adding a profile migrates the old connection to profile `default` without changing the default selection.
- Require `--replace` to overwrite a named profile. Lock configuration writes and replace the file atomically.
- Shorten the skill workflow and document profile setup, selection, migration, and rollback. Keep the dry-run and explicit confirmation requirements for Jenkins mutations.
- Add tests for profile selection, credential isolation, migration, CLI compatibility, build execution through a fake CLI, and temporary credential cleanup. All 19 Jenkins tests pass without a live controller.
- Add a pending minor Changeset for `@stagefright5/pi-jenkins-cli-operations`. Package versions remain unchanged.

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
