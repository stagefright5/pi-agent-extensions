# Local dev server

The Vite dev server provides HMR and a harness for testing Artifact runtime constraints
before publishing.

## Why use separate source files

A published artifact is one self-contained HTML file. CSP blocks external stylesheets
and images, so everything ships inline. Editing a single large file means working
without a module graph or HMR.

Develop in separate source files, then build a single file:

```
src/main.js  +  src/style.css  +  index.html
        ↓  dev — real HMR, CSS swapped without reload
        ↓  build — vite-plugin-singlefile inlines everything
dist/artifact.html   ← publish this
```

Build before publishing. `build.mjs` validates the output and exits non-zero if the
validator finds an error.

## Commands

```bash
node scripts/scaffold.mjs ~/work/my-page --title "My Page"
cd ~/work/my-page && npm install

npm run dev        # or: node <skill>/scripts/preview.mjs .
npm run build      # or: node <skill>/scripts/build.mjs .   (validates)

node <skill>/scripts/validate.mjs dist/artifact.html
```

## The harness

`artifactHarness()` in `vite.config.js` injects the harness. The plugin uses
`apply: "serve"`, so builds exclude it without a separate flag.

### Theme tri-state

The bottom-right control switches between system, light, and dark. `system` sets no
`data-theme` attribute. Most viewers use this state, which a `[data-theme]`-only
stylesheet renders incorrectly. Test all three states before publishing.

### Host-ground simulation

The `ground` toggle paints the opposite theme's background behind the document.
A body with no explicit `background` is transparent and shows that background.
The toggle makes this problem visible. The harness also displays a warning when
`body` has a transparent computed background.

### CSP

The dev server sends a Content-Security-Policy on every response. It relaxes the
production policy in two places:

| Directive     | Production | Dev                      | Why                  |
| ------------- | ---------- | ------------------------ | -------------------- |
| `script-src`  | allowlist  | `+ 'self' 'unsafe-eval'` | unbundled ES modules |
| `connect-src` | `'none'`   | `'self' ws: wss:`        | HMR socket           |

All other restrictions remain, so an `unpkg.com` import still fails locally.
`validate.mjs` enforces the full allowlist at build time by parsing the built file
and rejecting off-allowlist references.

The allowlist permits scripts from cdnjs / jsdelivr `/npm/` / cdn.tailwindcss.com /
code.jquery.com, stylesheets from fonts.googleapis.com, and fonts from fonts.gstatic.com.
CSP blocks everything else with no visible error, including images, media, fetch,
and any other host.

### Capability stub

The harness defines `window.artifactAgent` with stubbed methods for `complete`, `getUser`,
`readState`, `writeState`, `listAssets`, and `publish`. `window.claude` is an alias for the
same object, so pages written against the published runtime run unchanged. Every call
logs and returns a placeholder to help identify pages that depend on a capability
before publishing.

## What the validator checks

| Check                                             | Level   |
| ------------------------------------------------- | ------- |
| Off-allowlist external reference                  | error   |
| Non-inlined relative asset that would return 404  | error   |
| Custom property defined only inside a theme block | error   |
| Page over 16MB                                    | error   |
| No explicit `background` on `body`                | warning |
| No `<title>`                                      | warning |

The theme check catches tokens defined only inside `@media (prefers-color-scheme: dark)`
or `:root[data-theme="dark"]`. These tokens lack a base definition for the system state
with no theme attribute, which can render one theme's text on the other theme's
background.
