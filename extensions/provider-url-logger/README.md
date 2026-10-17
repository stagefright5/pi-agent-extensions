# Provider URL Logger

Most of this extension was written with the pi agent CLI.

Records the dispatched physical model and its configured endpoint for each request that emits a provider stream event.

[Back to the extension workspace](../../README.md)

## Logged data

The first `provider_stream_event` after each `before_provider_request` queues one line in this format. Its provider/model identity is physical even when the selected model is virtual:

```text
2026-07-15T12:58:12.345Z provider/model-id https://provider.example/v1
```

The fields are:

1. UTC timestamp in ISO 8601 format
2. provider name and model ID
3. the model's configured base URL

The extension does not log prompts, response content, request payloads, headers, or API keys.

## Log file

The extension appends entries to:

```text
~/.pi/agent/provider-urls.log
```

This is the default path. The extension uses `getAgentDir()` and respects `PI_CODING_AGENT_DIR`, creating the configured directory if necessary.

Before the active file would exceed 1 MiB, it rotates to `provider-urls.log.1`, replacing the previous archive. Both files are owner-only. A cross-process lock protects rotation and append. A base URL may still reveal private infrastructure or query parameters, so treat the log as potentially sensitive.

<!-- package-tools:install:start -->

## Installation

Install the standalone package:

```bash
pi install npm:@stagefright5/pi-provider-url-logger
```

<!-- package-tools:install:end -->

For source development, load this directory with `pi -e ./extensions/provider-url-logger` or expose it through the workspace's development symlink. Run `/reload` after source changes.

## Limitations

- File I/O is queued off the request/stream path and drained during orderly session shutdown. A forced process exit can lose queued lines.
- Logging failures produce at most one UI warning per session and do not block provider requests. Delayed failures never notify through a retired context or break the write queue.
- Request deduplication assumes Pi's serial agent-request lifecycle. Pi 1.3.0 exposes no request id on these hooks, so overlapping/interleaved streams cannot be reliably attributed and may be missed. This is a diagnostic log, not a complete HTTP access or billing log.
- Requests that fail before their first provider stream event are not recorded. The URL is the physical model's configured base URL, not an intercepted HTTP destination; redirects or authentication-time URL overrides may differ.
- There is no command, filter, or automatic redaction of the configured base URL.
