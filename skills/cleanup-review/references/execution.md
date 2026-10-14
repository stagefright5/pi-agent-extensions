# Execution evidence and recovery

Read the approval snapshot before any move. Confirm it belongs to this session and that the current paths, saved choices, and notes still match. The executor does these checks again. It treats all nonempty notes as requiring agent handling because it cannot interpret instructions such as "after the migration". Do not erase a note or edit an approval to bypass that check.

The page sends approval to the agent. The server does not execute shell commands. Once the user has approved exact paths, the agent can inspect and execute them without another permission prompt, provided saved conditions are satisfied.

## Supported helper operations

`node_modules` directories need an owning Git repository, no tracked files inside, and no open files found by `lsof`. The source repository and its HEAD remain in place. Agent review must still establish that packages can be restored and no needed manual edits live inside them.

Exact duplicate files need this evidence on the card:

```json
{
  "verification": {
    "type": "identical-files",
    "retain": "~/Documents/retained-copy.txt",
    "sha256": "FULL_SHA256_DIGEST"
  }
}
```

Hash both copies before proposing the item. The helper rechecks the source and retained copy before moving, then checks the moved file and retained copy again. The retained path must be outside every approved move. Filenames and extensions do not establish identity.

Generated files and directories need a concrete recreation reason:

```json
{
  "verification": {
    "type": "generated-directory",
    "reason": "This directory contains rebuildable output from the named build command."
  }
}
```

Use `generated-file` for a file. The helper refuses tracked output or a generated directory containing `.git`. The agent must establish that the selected directory is actually generated, that its producer is stopped, and that shared consumers do not need it. The metadata is evidence, not an authorization substitute.

For a whole repository or linked worktree, use `kind: "repo"` or `kind: "worktree"` and a `git-review` record after completing the Git review below:

```json
{ "verification": { "type": "git-review", "head": "FULL_HEAD_ID", "statusSha256": "SHA256_OF_STATUS_TEXT" } }
```

Compute the status digest from the exact output of `git --no-optional-locks -C PATH status --porcelain=v1 --untracked-files=all --ignored`, decoded as text with trailing newline characters removed. The executor uses that same form. Refresh the card with a new ID if the approved evidence becomes stale. A status digest does not detect every content edit to an already modified file; stop writers before execution. Moving preserves such files, but the review must account for them.

## Whole repositories and worktrees

Before proposing the whole directory, inspect:

- Tracked changes, untracked and ignored files, stashes, and commits on all local branches.
- Remotes and upstreams, including local branches absent from cached remote refs. State when remote reachability or freshness is unverified.
- `git worktree list --porcelain`, absolute Git directory, common Git directory, worktree locks, submodules, and running processes.
- User notes, migration plans, local configuration, secrets, and any valuable files outside the tracked tree.

A linked worktree needs `git worktree move SOURCE DESTINATION` against its retained common repository. Do not use `git worktree remove`, `prune`, `--force`, or manually delete registrations for this recoverable workflow. The helper verifies Git's new working directory, HEAD, and status. Its restore command uses `git worktree move` in reverse.

A standalone repository with its own `.git` directory can move by rename if it owns no other linked worktrees. A main repository with linked worktrees remains blocked until their relationships have been handled explicitly. The helper also blocks Git metadata stored externally, such as a separate `.delta` directory. These cases require an inspected move-and-repair procedure, including the reverse repair in restore instructions. Never move or delete shared metadata merely to make a command pass.

## Journals and unsupported cases

The helper locks execution per session. Before moving anything, it writes a journal and planned destinations. It records each identity check, move, and verification. It checks that the destination has the same device and inode, the source is absent, and relevant Git or hash evidence still holds. This preserves recoverability; it does not free disk space.

A nonempty note, changed source, open file, external Git layout, cross-volume move, or unsupported scope stops automatic execution. Read the error and saved note. If you can satisfy the user's conditions safely, handle that approved scope manually and journal it. Otherwise leave the path blocked with its reason. Do not label a blocked batch complete.

For an agent-handled move, preserve the approval unchanged and write a `trash-move-*.json` record in the session folder. Use the same schema:

```json
{
  "approvalId": "EXACT_APPROVAL_ID",
  "batch": "/absolute/home/.Trash/unique-cleanup-folder",
  "restoreFile": "/absolute/home/.Trash/unique-cleanup-folder/RESTORE.txt",
  "complete": false,
  "entries": [
    {
      "itemId": "STABLE_ITEM_ID",
      "choice": "shortlist",
      "source": "/absolute/approved/source",
      "destination": "/absolute/home/.Trash/unique-cleanup-folder/source",
      "status": "blocked",
      "error": "Concrete reason this move cannot proceed"
    }
  ]
}
```

Use absolute source paths expanded from the session's home. Write atomically before moving and after each step. Valid statuses are `pending`, `checked`, `moving`, `moved`, `verified`, and `blocked`. Preserve device/inode and Git or hash evidence where applicable. Make a restore record before the move. Set `complete: true` only when every approved path is verified. Use one journal per approval; update it during recovery rather than making an ambiguous second journal.

## Recover an interrupted run

Do not replay the approval. Read its journal and inspect both paths for every entry. If both source and destination exist, stop and compare them; never overwrite or merge automatically. If a move happened but verification did not, verify its identity and Git relationships before updating the existing journal. If it never happened, recheck the approval conditions before continuing manually.

To restore, stop related processes and check the recorded source is absent. Review the generated commands and restore only paths that moved. Use the worktree command where recorded, preserve shared metadata, and verify HEAD and status afterward. Keep the journal as the record of what happened.
