# OpenAI Fast

Adds `service_tier: "priority"` (OpenAI Fast mode) to requests for the `openai` and `openai-codex` providers.

[Back to the extension workspace](../../README.md)

<!-- package-tools:install:start -->

## Installation

Install the standalone package:

```bash
pi install npm:@stagefright5/pi-openai-fast
```

<!-- package-tools:install:end -->

## Usage

- `/fast` toggles it and atomically saves `{ "enabled": true }` or `false` in `getAgentDir()/openai-fast.json`, an owner-only file. It never rewrites Pi's shared settings. Until a saved override exists, the effective merged `openaiFast` setting remains the default.
- `pi --fast` turns it on for one run without saving.
- The footer shows `⚡︎` while it is on and the current model is OpenAI. With Compact Status Bar, it appears immediately after the thinking/effort level.

It is off by default. `/fast` only turns on while an OpenAI model is selected.

## Notes

- Priority costs more credits or money. OpenAI may still serve the request at the normal tier.
- Other providers are never changed.
- Don't combine it with another extension that sets `service_tier`.
