# Provider URL Logger

A small diagnostic extension that records which provider endpoint pi selects for each provider request.

[Back to the extension collection](./README.md)

## Logged data

Each `before_provider_request` event appends one line in this format:

```text
2026-07-15T12:58:12.345Z provider/model-id https://provider.example/v1
```

The fields are:

1. UTC timestamp in ISO 8601 format
2. provider name and model ID
3. the model's configured base URL

The extension does **not** log prompts, response content, request payloads, headers, or API keys.

## Log file

Entries are appended to:

```text
~/.pi/agent/provider-urls.log
```

The file is never truncated or rotated automatically. Remove or rotate it yourself if it grows too large. A base URL may still reveal private infrastructure or query parameters, so treat the log as potentially sensitive.

## Installation

Install the [complete collection](./README.md#install-the-complete-collection), or copy `log-provider-url.ts` into one of pi's extension directories:

```bash
cp log-provider-url.ts ~/.pi/agent/extensions/
```

Run `/reload` or restart pi after installation.

## Limitations

- Logging is synchronous and occurs immediately before provider request handling.
- If the log cannot be opened or written, pi reports the extension hook error and continues according to pi's extension error handling.
- There is no command, filter, retention policy, or automatic redaction of the configured base URL.
