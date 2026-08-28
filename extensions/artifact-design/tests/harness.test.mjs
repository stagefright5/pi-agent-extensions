import { test } from "node:test";
import assert from "node:assert/strict";
import { artifactHarness } from "../scripts/lib/harness/plugin.mjs";
import { devPolicy, productionPolicy, isAllowed } from "../scripts/lib/harness/csp.mjs";

test("harness plugin is serve-only, so it cannot reach a build", () => {
  assert.equal(artifactHarness().apply, "serve");
});

test("harness injects styles and script into the body", () => {
  const tags = artifactHarness().transformIndexHtml();
  assert.equal(tags.length, 2);
  assert.ok(tags.every((t) => t.injectTo === "body"));
  assert.ok(tags.some((t) => t.tag === "script" && t.children.includes("artifactAgent")));
  assert.ok(tags.some((t) => t.tag === "style" && t.children.includes("__artifact_harness")));
});

test("harness can be disabled", () => {
  assert.deepEqual(artifactHarness({ harness: false }).transformIndexHtml(), []);
});

test("dev policy relaxes only the HMR socket and module loading", () => {
  const dev = devPolicy();
  const prod = productionPolicy();
  assert.match(dev, /connect-src 'self' ws: wss:/);
  assert.match(prod, /connect-src 'none'/);
  for (const host of ["cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"]) {
    assert.ok(dev.includes(host) && prod.includes(host), host);
  }
  assert.ok(!dev.includes("unpkg"));
  assert.ok(!/script-src[^;]*\*/.test(dev), "dev script-src must not wildcard");
});

test("allowlist buckets are enforced per kind", () => {
  assert.ok(isAllowed("script", "https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.js"));
  assert.ok(!isAllowed("script", "https://fonts.googleapis.com/x.js"));
  assert.ok(isAllowed("style", "https://fonts.googleapis.com/css2?family=Inter"));
  assert.ok(!isAllowed("style", "https://cdnjs.cloudflare.com/a.css"));
  // A connection hint may name any allowlisted origin.
  assert.ok(isAllowed("hint", "https://fonts.gstatic.com"));
  assert.ok(!isAllowed("hint", "https://unpkg.com"));
});
