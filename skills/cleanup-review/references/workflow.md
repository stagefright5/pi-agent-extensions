# Inventory and review

Honor the scope the user has already given. If no scope is established, start with the named directory and ask about extending it only when that matters. Whole-home permission includes local metadata, but does not make every discovered file disposable.

Create a private session outside candidate directories. Keep the session and Trash out of scans. The scanner walks local metadata without following symlinks, descending into `.git` or `node_modules`, or reading document contents. It excludes known macOS cloud directories and skips dataless placeholders. Add other cloud provider roots with `--exclude`. Record inaccessible locations as unknown, not empty.

```sh
python3 "$skill_dir/scripts/cleanup.py" scan "$HOME" \
  --exclude "$session_dir" --output "$session_dir/inventory.json"
```

The inventory is evidence for the agent. It is not a deletion recommendation or the website's card list. Measure shortlisted directory sizes with `du -sk` after checking that they are local. Do not sum overlapping parent and child sizes. Moving to Trash does not free storage until Trash is emptied separately.

For repositories and linked worktrees, inspect current status, stashes, all local branches, configured remotes, worktree registrations, locks, and ignored files. Compare commits against locally available remote refs and describe those refs as cached unless they were refreshed. A clean tracked status alone does not prove a project has no local work. Record secrets, untracked data, and shared Git directories without copying their contents into the review page.

For `node_modules`, identify the owning repository and lockfile. Check tracked contents, manual patches, local linked packages, private registry availability, active processes, and whether the user still builds the project. Offer dependencies separately even when retaining the project. Avoid grouping protected projects into a broad dependency proposal.

For generated output and logs, identify the producer and confirm it has stopped using the paths. Explain the loss of build time, offline archives, or diagnostic history. Treat package stores separately from per-project installs. A large shared pnpm store can still serve installed projects; do not propose moving it based on size alone.

For documents, age and a filename such as `Untitled` do not establish redundancy. Compare contents before calling files duplicates. Record a retained copy outside every proposed move and SHA-256 evidence for exact duplicates. Keep distinct documents unless the user gives a reason to remove them. Avoid opening sensitive content when metadata and hashes answer the question.

## Curate the next batch

Use about five items when that keeps decisions easy. A large group should have a single clear rationale and expandable exact paths. Split groups when the user could reasonably want different outcomes.

Each card needs concrete evidence: where it lives, its size, why you picked it, and what remains uncertain. Keep paths and rationale visible. Do not bury the proposal under an inventory table. The user can keep it, defer it, shortlist it, choose only its dependencies, or type a note or question.

Persist notes in `review-state.json`. Tell the user where their responses are saved when they ask. Notes stay local; clicking Send forwards the message to the configured agent conversation. The bridge stores a local message transcript and delivery receipts. It never silently retries an uncertain delivery.

When the user asks for another batch, recheck the remaining candidates against saved decisions and completed journals. Do not keep resurfacing kept items without new evidence. If nothing useful remains, say what was checked and stop. An unfinished integration or migration remains a separate task, even if its dependencies have been removed.
