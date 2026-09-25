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

- `/fast` toggles it and saves the choice as `"openaiFast": true` in `~/.pi/agent/settings.json`.
- `pi --fast` turns it on for one run without saving.
- The footer shows `fast` while it is on and the current model is OpenAI.

It is off by default. `/fast` only turns on while an OpenAI model is selected.

## Notes

- Priority costs more credits or money. OpenAI may still serve the request at the normal tier.
- Other providers are never changed.
- Don't combine it with another extension that sets `service_tier`.
