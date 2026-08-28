import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validate } from "../scripts/lib/validate.mjs";

const dir = mkdtempSync(join(tmpdir(), "artifact-validate-"));
let n = 0;
const write = (html) => {
  const f = join(dir, `p${n++}.html`);
  writeFileSync(f, html);
  return f;
};

const GOOD_CSS = `:root{--ground:#fff;--ink:#111}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--ground:#111;--ink:#eee}}
:root[data-theme="dark"]{--ground:#111;--ink:#eee}
body{background:var(--ground);color:var(--ink)}`;

const page = (head = "", css = GOOD_CSS, body = "") =>
  `<!doctype html><html><head><title>T</title>${head}<style>${css}</style></head><body>${body}</body></html>`;

test("clean page passes", () => {
  const r = validate(write(page()));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test("allowlisted script and font are accepted", () => {
  const r = validate(
    write(
      page(
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">' +
          '<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>',
      ),
    ),
  );
  assert.deepEqual(r.errors, []);
});

test("off-allowlist script host is an error", () => {
  const r = validate(write(page('<script src="https://unpkg.com/thing.js"></script>')));
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /unpkg\.com/);
});

test("external image is an error", () => {
  const r = validate(write(page("", GOOD_CSS, '<img src="https://example.com/a.png">')));
  assert.match(r.errors[0], /data: URI/);
});

test("non-inlined relative asset is an error", () => {
  const r = validate(write(page("", GOOD_CSS, '<img src="./assets/logo.png">')));
  assert.match(r.errors[0], /404/);
});

test("data: URI image is fine", () => {
  const r = validate(write(page("", GOOD_CSS, '<img src="data:image/gif;base64,R0lGOD">')));
  assert.deepEqual(r.errors, []);
});

test("token defined only in a theme block is an error", () => {
  const css = `:root{--ground:#fff}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--ground:#111;--accent:#f0f}}
body{background:var(--ground)}`;
  const r = validate(write(page("", css)));
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /--accent/);
});

test("missing body background warns", () => {
  const r = validate(write(page("", ":root{--ground:#fff}\n.x{color:red}")));
  assert.match(r.warnings[0], /transparent body/);
});

test("missing title warns", () => {
  const f = write(`<!doctype html><html><head><style>${GOOD_CSS}</style></head><body></body></html>`);
  const r = validate(f);
  assert.ok(r.warnings.some((w) => /title/.test(w)));
});
