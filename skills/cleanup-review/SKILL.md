---
name: cleanup-review
description: Inventory local cleanup candidates and run a swipe review website with two-way agent chat, exact-path approvals, verified moves to Trash, and restore records. Use for reviewing repositories, worktrees, dependencies, generated output, and duplicate documents before cleanup.
---

# Cleanup review

Use the included website to present a few evidence-backed choices at a time. Show paths, measured size, the reason for proposing removal, and what needs checking. Keep the larger inventory in the session folder. Do not make the user review every discovered file.

The package includes the website, a local WebSocket server, Codex and Pi conversation connections, a Trash executor, and tests. Read [references/workflow.md](references/workflow.md) for inventory and review decisions. Read [references/runtime.md](references/runtime.md) to create a session, supply items, and connect its website.

## Preserve the review boundary

- A swipe, shortlist, or saved note records a preference. Execute only after explicit authorization for the exact paths. The site's **Approve move to Trash** action supplies that authorization and sends it to the connected conversation. Do not ask again for approval already granted.
- Offer **Only node_modules** separately from moving a repository. Preserve its source and Git history for that choice.
- Respect free-text notes and earlier keep decisions. A migration request means preserve the source until the migration finishes. Do not infer completion.
- Move into a dated folder in `~/.Trash`. Never empty Trash as part of this workflow. Shared caches require checking their live consumers before proposing removal.
- Use stable item IDs. A changed target scope needs a new ID and review. Retain prior notes, approvals, journals, and restore records.

## Execute approved selections

Read the approval snapshot and its notes before running the helper. Inspect current files and Git state using [references/execution.md](references/execution.md). Run the copied session helper only when its supported scope matches:

```sh
python3 "$session_dir/execute-approved-cleanup.py" --approval "$approval_id"
```

The helper checks identity, path overlaps, open files, saved choices, and relevant Git or duplicate evidence. It moves through same-volume renames or `git worktree move`, then verifies each result. It records blocked paths and refuses to replay an approval that already has a journal. Read a failed journal before deciding how to recover.

The website reads progress from journals matched by `approvalId`. Mark a move verified only after checking the destination and absent source. Celebrate only when every approved path is verified. Report blocked paths plainly and leave the rest recoverable.

## Maintain the package

Use `scripts/test.sh` for isolated Python, website, approval, and conversation tests. It creates temporary homes and installs the locked WebSocket dependency into a temporary directory. Keep session inventories, credentials, messages, approvals, generated pages, and `node_modules` out of this skill folder.
