# Side Agent

Open an independent, fully capable side agent beside the main Pi conversation, in a right-hand [Rex](https://www.superlogical.com/rex/docs) split of the same tab.

[Back to the extension workspace](../../README.md)

The side agent starts as a copy of the main conversation through its last completed turn. It then continues on its own, as a separate Pi process with its own session file, the same working directory, and the same configured extensions, skills, MCP servers, and tools. Nothing from the side agent reaches the main conversation unless you send a result back and accept it.

This is one Rex session with two independent Pi sessions. The two processes never write the same transcript.

## Commands

| Command        | Where      | Behavior                                                                                                 |
| -------------- | ---------- | -------------------------------------------------------------------------------------------------------- |
| `/side`        | main agent | Focus the open side pane, reopen the most recent side conversation, or create the first fork.            |
| `/side new`    | main agent | Fork from the current completed boundary and open it in a new split.                                     |
| `/side list`   | main agent | Choose a saved side conversation to reopen.                                                              |
| `/side close`  | main agent | Close the managed side pane. The conversation is kept.                                                   |
| `/side inbox`  | main agent | Preview pending results, then accept or dismiss them.                                                    |
| `/side send`   | side agent | Edit the latest completed response, or replace it with a summary, and send it to the main agent's inbox. |
| `/side parent` | side agent | Focus the main agent's pane if it is still open.                                                         |
| `/side`        | side agent | Choose between send and parent.                                                                          |

Each main conversation has at most one managed side pane at a time but can keep many saved side conversations. Close the open pane before opening another.

The split takes half of the main pane and receives focus. Use Rex's normal shortcuts to resize panes and move between them. Opening a side agent never submits a prompt.

## What the side agent inherits

### Conversation

The side agent receives an immutable copy of the active branch from the root through the fork boundary:

- messages, images, and tool exchanges
- compactions, branch summaries, and context edits, so its model context matches the main agent's at that point
- system prompt and tool-loadout patches, labels, the model and thinking level, and extension state on that branch

Abandoned branches are not copied. Later main-agent messages never reach the side agent.

If the main agent is idle, the boundary is its current position. If it is working, the boundary is the last completed turn before the current request: its pending input, partial output, and unfinished tool calls are excluded. The fork point is captured before any Rex work, so later activity cannot move it.

If no completed exchange exists yet, `/side new` explains why instead of copying partial work. Unsaved sessions (`--no-session`) cannot be forked.

The copy is written as an ordinary Pi session file next to the main session, with `parentSession` pointing at it. It is verified by reopening it and comparing its model-visible context with the main agent's context at the boundary.

### Configuration

The child runs the same Pi installation, in the same working directory, with its saved session path. Standard discovery still applies, so configured extensions, skills, prompt templates, themes, MCP servers, and stored credentials load as usual.

From the main agent's command line, only these options are reconstructed, with relative paths made absolute: extensions, skills, prompt templates, themes, system-prompt and appended prompts, tool selection and exclusion, `--models`, `--session-dir`, resource-disabling flags, `--offline`, `--tui-mode`, `--use-theme`, and `--verbose`. Project trust follows the main agent's effective decision. Non-secret Pi variables such as `PI_CODING_AGENT_DIR` are passed explicitly. Session, prompt, and mode arguments are never forwarded, nor is parent-session identity (`PI_SESSION_*`, `REX_BLOCK`).

Before a new side agent accepts prompts, it compares itself with the main agent:

- active tools, tools callable through codemode or tool search, and configured tools
- model, thinking level, and whether credentials are available

The child-only `side_agent_send` messaging tool is an intentional addition and is excluded from this inheritance comparison. Other tool differences are still checked.

MCP tools get a short grace period to connect. If anything still differs, the side agent lists the differences and asks whether to continue. Declining closes it and keeps its conversation. Reopened side agents keep their own tool and model choices, so only missing configured tools are reported.

A main agent started with `--api-key` cannot open side agents: the key exists only in that process, and secrets are never placed on a command line. Credentials exported only in the main agent's shell are not inherited either; Rex starts the child with your login environment.

### Restrictions and state

Saved restrictions travel with the conversation. A side agent forked from a Plan Mode conversation is still in Plan Mode, with its plan history but without approval. Its first plan revision is written to a new plan repository, seeded with the inherited plan, so it never overwrites the main agent's plan files.

Process-local state is recreated, not cloned: running background jobs, tool handles, MCP connections, and other extension memory. References to the main agent's jobs in the copied history do not give the side agent control of them.

## Shared workspace

> [!WARNING]
> Both agents work in the same directory with full tools. There is no filesystem snapshot, worktree, or conflict resolution. Edits, commands, and external side effects from either agent affect the other. Coordinate file changes yourself.

The side agent is a separate model session, so it has its own context and model costs.

## Sending results back

1. In the side agent, ask **“send hi to main agent”** (or ask to send a specific result). The agent can call its child-only `side_agent_send` tool with `{ "text": "hi" }`, directly or through codemode. No editor or extra child-side confirmation is needed for that explicit request. Alternatively, run `/side send` to edit the latest completed response or write your own summary; submitting empty text cancels. Both paths use the same validated inbox writer, with a 64 KiB UTF-8 limit.
2. The main agent shows a notification and a status count.
3. In the main agent, run `/side inbox`, preview the result, and press `a` to accept or `d` to dismiss. `Esc` keeps it pending.

An accepted result is added as a side-agent message that names its source conversation. It is labelled as another agent's output, not as a user instruction or system message. Accepting never starts a model turn or touches the editor; the main agent sees the result with your next message. If the main agent is busy, the result is added after it finishes.

The send tool takes only text: parent and child IDs, transcript path, and fork boundary come from the active session and its stored linkage. Sending is refused for duplicate writers, stale sessions, pending or rejected configuration checks, and missing or inconsistent linkage. The tool's guidance requires an explicit user send request and forbids writing inbox, linkage, or control files directly. These are behavioral guardrails, not filesystem isolation; both agents still have shared filesystem access. Existing tool restrictions still apply—if the send tool is unavailable or blocked, the agent must report that rather than bypass it.

A result is selected text, not a branch merge, approval transfer, or tool replay. Results wait while the main agent is offline or another session is open in it. Delivery is reconciled with the main transcript, so a crash or reload cannot import the same result twice. Results addressed to another conversation, or from a side agent that is not its child, are quarantined.

## Panes, recovery, and safety

- Panes are identified by the Rex server instance, session, and full block ID returned by the split, plus a per-launch token. Before focusing or closing, the extension proves that the expected process runs in that pane. It never acts on whichever pane has focus.
- `/side close` asks the child to shut down gracefully, confirms first if it is working or its state is unknown, and asks again before force-closing a pane that does not exit. Only that one block is ever closed; never a tab or session.
- Launches are reserved exclusively, so two processes cannot open the same side conversation. If a Rex call times out after creating the pane, the pane is found by its unique label instead of creating another. A side conversation that is already running is focused rather than started again.
- If the side pane is closed by hand, the next `/side` reopens the conversation. Restarting or switching the main agent does not stop the side agent; its link is kept and checked against Rex next time.
- If a launch fails, the pane is kept for inspection and the conversation stays saved.

Resume a side conversation manually at any time:

```bash
pi --session <side-session-file>
```

A manually resumed side agent still recognizes itself: `/side send` works, and opening it twice warns that another process already owns it. Without a launch from `/side`, `/side parent` cannot find the main pane.

## Storage

Links and inbox files live in `<agent-dir>/side-agent/` (normally `~/.pi/agent/side-agent/`) with private permissions and atomic writes. They are keyed by Pi session IDs, never by labels or paths alone. Session files use Pi's normal session directory. Transcripts are never logged.

## Requirements and limitations

- Pi 1.3.0 or newer in interactive terminal mode, running inside a local Rex pane. Rex API revision 10 or newer.
- Local Pi and Rex on the same host. Cross-host side agents are out of scope.
- No nested side agents, automatic spawning, or automatic summaries.

## Removal

Disable or remove the extension and run `/reload`. Close side panes yourself. Side conversations remain ordinary resumable Pi sessions; delete their files and `<agent-dir>/side-agent/` only if you no longer need them.

## Files

- [`index.ts`](./index.ts) registers the command, child-only send tool, lifecycle hooks, child checks, inbox, and result rendering.
- [`fork.ts`](./fork.ts) selects the completed boundary, captures the branch, and writes and verifies the child transcript.
- [`rex.ts`](./rex.ts) wraps the Rex CLI: identity, split, inspection, focus, and close.
- [`launch.ts`](./launch.ts) builds the child command and compares capabilities.
- [`store.ts`](./store.ts) owns links, launch reservations, liveness, control requests, and the inbox.

<!-- package-tools:install:start -->

## Installation

Install the standalone package:

```bash
pi install npm:@stagefright5/pi-side-agent
```

<!-- package-tools:install:end -->

For source development, load this directory with `pi -e ./extensions/side-agent` or expose it through the workspace's development symlink. Run `/reload` after source changes.
