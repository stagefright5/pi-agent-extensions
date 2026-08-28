# Local dev server

Vite dev server with HMR, plus a harness that reproduces the parts of the Artifact
runtime that only bite after publish.

## Why split source at all

A published artifact is one self-contained HTML file — the CSP blocks external
stylesheets and images, so everything ships inline. That is a bad authoring format:
no module graph, no HMR, one 2000-line file.

So author split and build to single:

```
src/main.js  +  src/style.css  +  index.html
        ↓  dev — real HMR, CSS swapped without reload
        ↓  build — vite-plugin-singlefile inlines everything
dist/artifact.html   ← publish this
```

The build step is the only thing between editing and publishing. `build.mjs` runs
the validator afterwards and exits non-zero if the output would break once published.

## Commands

```bash
node scripts/scaffold.mjs ~/work/my-page --title "My Page"
cd ~/work/my-page && npm install

npm run dev        # or: node <skill>/scripts/preview.mjs .
npm run build      # or: node <skill>/scripts/build.mjs .   (validates)

node <skill>/scripts/validate.mjs dist/artifact.html
```

## The harness

Injected by `artifactHarness()` in `vite.config.js`. The plugin is `apply: "serve"`,
so it cannot reach a build — there is no flag to forget.

### Theme tri-state

Bottom-right control switches **system / light / dark**. `system` is the important
one: it stamps _no_ `data-theme` attribute, which is the state most viewers are in
and the state a `[data-theme]`-only stylesheet renders wrong. Cycle all three before
publishing.

### Host-ground simulation

`ground` toggle paints the _opposite_ theme's ground behind the document. A body with
no explicit `background` is transparent and silently borrows that ground — with the
toggle on, it goes obviously wrong instead of invisibly wrong. The harness also warns
inline when it computes `body` as transparent.

### CSP

The dev server sends a Content-Security-Policy on every response. It is a deliberate
superset of production, relaxed in exactly two places:

| Directive     | Production | Dev                      | Why                  |
| ------------- | ---------- | ------------------------ | -------------------- |
| `script-src`  | allowlist  | `+ 'self' 'unsafe-eval'` | unbundled ES modules |
| `connect-src` | `'none'`   | `'self' ws: wss:`        | HMR socket           |

Nothing else is loosened, so a stray `unpkg.com` import still fails locally. Because
dev cannot be fully strict, **the real enforcement is at build time** — `validate.mjs`
parses the built file and rejects any off-allowlist reference.

Allowlist: scripts from cdnjs / jsdelivr `/npm/` / cdn.tailwindcss.com / code.jquery.com,
stylesheets from fonts.googleapis.com, fonts from fonts.gstatic.com. Everything else —
images, media, fetch, any other host — is blocked with no visible error.

### Capability stub

`window.artifactAgent` is defined with stubbed `complete`, `getUser`, `readState`,
`writeState`, `listAssets`, `publish`. `window.claude` is aliased to the same object so
pages written against the published runtime run unchanged. Every call logs and returns
an obvious placeholder, so a page depending on a capability fails loudly here rather
than silently in production.

## What the validator checks

| Check                                               | Level   |
| --------------------------------------------------- | ------- |
| Off-allowlist external reference                    | error   |
| Non-inlined relative asset (would 404)              | error   |
| Custom property defined _only_ inside a theme block | error   |
| Page over 16MB                                      | error   |
| No explicit `background` on `body`                  | warning |
| No `<title>`                                        | warning |

The theme check is the one worth understanding: a token whose only definition sits
inside `@media (prefers-color-scheme: dark)` or `:root[data-theme="dark"]` is
**undefined** in the unstamped system state, which renders one theme's text on the
other theme's ground.
