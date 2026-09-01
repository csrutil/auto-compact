# auto-compact

A [Pi package](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)
that prepares compaction in the background with a dedicated model. When Pi
needs to compact, the extension uses the prepared result if it still applies to
the active branch. Otherwise, it runs compaction with the configured model.
After compaction succeeds, it reports the model, thinking level, token usage,
cost, and elapsed compaction time.

## Install

Install from GitHub:

```sh
pi install https://github.com/csrutil/auto-compact
```

To try it for one session without installing it:

```sh
pi -e git:github.com/csrutil/auto-compact
```

Remove or disable another copy of `compact.ts` before loading this package so
that compaction is handled only once.

## Configure

Add the extension-specific `provider`, `model`, and `backgroundThreshold`
fields to the existing `compaction` object in `~/.pi/agent/settings.json`:

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 16384,
    "provider": "google-vertex",
    "model": "gemini-3.7-flash",
    "thinkingLevel": "high",
    "backgroundThreshold": 80
  }
}
```

- `provider` and `model` identify the model used for compaction.
- `thinkingLevel` controls reasoning effort and defaults to `high`. Supported
  values are `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`.
- `backgroundThreshold` is the context-window percentage at which background
  compaction begins.
- The remaining fields use Pi's standard compaction behavior.

The selected model must be available in Pi's model registry. Reload Pi after
changing the settings or extension.

## Develop

```sh
npm install --ignore-scripts
npm run check
```
