---
description: Choose Assets/CMDB graph or native/AQL queries, resolve types and relationships, filter with -w, and read inline product fields.
---

# Assets graph queries

Use `assets graph` only to follow relationships between entities, such as an
object and its owner, or to filter an entity by a related one. For single-type
lookups, known-object attributes, or keyword searches without a relationship
traversal, use `assets search`, `assets query --aql`, or `assets object get`.
These need no schema download. Do not fetch the graph schema or call
`connections` for them.

For a relationship traversal, start with the graph rather than `assets search`
or AQL. Aim for one `connections` call covering the requested path.

The downloaded schema is the source of truth. Resolve every type, relationship,
and field name from it. Do not use names from `assets search`, AQL, or the
prompt without checking them.

1. **Fetch the schema once, to a file.**
   `twg assets graph schema -o json --output-file /tmp/assets-schema.json` (add
   `--workspace <id-or-ari>` / `--site <site>` for a non-default workspace). Use an
   absolute path so reruns reuse it. The schema is cached for about 24 hours.
   Always use `--output-file` and inspect the file with `jq`; stdout truncation
   can produce invalid JSON. Fetching the schema is the discovery step.
   Do not run `help describe` on graph subcommands first.
   Once you know the nouns, scope reads with `--node <name>` (repeatable, fuzzy):
   `twg assets graph schema --node "Maruti Suzuki" -o json` returns just that type
   plus its relationships. Prefer that to filtering the whole file again.
2. **Resolve each noun to an exact type `name`.** Nouns rarely match verbatim
   ("Maruti Suzuki Cars" → `Maruti Suzuki`, "Hyundai cars" → `Hyundai`). Enumerate
   and match the schema names. Do not use `assets search` or AQL to find a type:
   `jq -r '.data.nodes[].name' file` (also `.data.staticNodeTypes[]` and
   `.data.staticNodeAliases|keys[]`). Match case-insensitively, substring both
   directions, and on the distinctive token after dropping qualifiers/plurals.
   Never dump the whole schema to stdout. Do not send `jq '.data.nodes'`,
   `.data.relationships`, or a whole-object projection _with `metadata`_ to the
   terminal. That output alone can exceed 1 MB. `jq` only the fields
   you need (`.name`, keys), filter to the resolved type
   (`jq '.data.nodes[]|select(.name=="Maruti Suzuki")' file`), or use
   `schema --node`; route any broad projection to another `--output-file`.
3. **Pick the relationship for every hop from the schema; pass one `-r` per hop**
   (path order, or `--relationships r1,r2,...`). `relationships[]` = dynamic edges
   (any Assets endpoint); `staticRelationships[]` = static product↔product edges
   (e.g. `IdentityUser`→`ConfluencePage`); `JiraIssue`↔`AssetsObject` = the static
   bridge `jira-work-item-links-assets-object`. Omitting `-r` on a pair with
   multiple edges fails in agent mode, so choose the relationship first.
4. **People→team uses `AtlassianUser`/`AtlassianTeam`** via the static edge
   `atlassian_user_is_in_atlassian_team`. `IdentityUser` aliases `AtlassianUser`, so
   `… IdentityUser AtlassianTeam -r <owner-rel> -r atlassian_user_is_in_atlassian_team`.
   `IdentityTeam` has **no** membership edge.
5. **Execute the whole path:**
   `twg assets graph connections <t1> <t2> … -r <r1> -r <r2> --execute -o json`
   (`--execute` required in agent mode; `--show-cypher` to inspect; `--direction
out|in|any`; `--optional-hop <n>` for OPTIONAL MATCH).
6. **Filter / timebound in the same call** with `-w "[N:|rN:]field[op]value"` (`N` =
   0-based node index, default 0; `rN` = hop N's relationship metadata; ops
   `= != > >= < <=`). Use the **exact graph field name, bare** (read
   dynamic-node fields from `nodes[].metadata`), not the AQL name. `Updated` and
   `Created` fail here. Node timestamps are `createdAt`/`lastUpdated`; edges expose the
   same two. **Identity and product nodes are keyed by `ari`, not `id`.** For a
   rolling window, precompute the absolute cutoff (ISO dates auto-wrap in
   `datetime()`), e.g. `-w "0:lastUpdated>2026-07-22"` or `-w "r0:lastUpdated>2026-07-22"`.

**Rows hydrate supported product types inline.** Confluence pages/blogposts, Jira
issues, Loom videos, and Atlas goals/projects come back with display fields
such as name, title, key, URL, status, and updated time already on the row.
Read them without a follow-up `content get` or `workitem get`. **Assets objects (cmdb) and users
are not hydratable** (OAuth scope) and return id/ARI only; resolve those names with
the product-native command (`assets object get`, `resolve`, `user search`), one
batched call per type (repeat `--account-id` / pass multiple ids), not one per row.
Because a cmdb object can't be hydrated, **any path that includes a dynamic Assets
node returns id-only for the whole row**. Hydration is skipped, not failed.
Assets-anchored paths therefore need product-native commands to resolve object names.
`--no-hydrate` forces id-only everywhere.

An unknown type returns
`Unknown graph node type "…". Did you mean: …?`; a missing edge lists reachable
targets. Use those hints. Do not fall back to `assets search` or client-side joins.

Use one `twg assets query --aql "<AQL>"` for an object or attribute question the
graph path cannot answer. AQL recency filters use attribute names, such as
`Updated > now(-10d)`. A time window alone is not a reason to leave
`connections`. Use `-w` as described in step 6. `assets search` is only a
shallow name lookup: for owner/attribute work inspect the schema/object type
first, then batch `assets query`/`assets object query` with repeated
`--account-id` rather than one call per object.

Split into multiple commands only when a single one is truly impossible: a
non-linear shape (branch/cycle), or a hop with no edge in
`relationships[]`/`staticRelationships[]`/the Jira bridge (pick a different
intermediate type). Path length, static/product hops, and time windows are not
reasons to split.
