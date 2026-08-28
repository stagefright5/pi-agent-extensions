import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const scaffold = join(here, "..", "scripts", "scaffold.mjs");

test("scaffold produces a runnable project", () => {
  const target = join(mkdtempSync(join(tmpdir(), "artifact-scaffold-")), "my-page");
  execFileSync(process.execPath, [scaffold, target, "--title", "Device Flow"], { encoding: "utf8" });

  for (const f of ["index.html", "package.json", "vite.config.js", "src/main.js", "src/style.css"]) {
    assert.ok(existsSync(join(target, f)), `missing ${f}`);
  }

  const html = readFileSync(join(target, "index.html"), "utf8");
  assert.match(html, /<title>Device Flow<\/title>/);
  assert.ok(!html.includes("__TITLE__"), "title placeholder not substituted");

  const cfg = readFileSync(join(target, "vite.config.js"), "utf8");
  assert.ok(!cfg.includes("__HARNESS_PATH__"), "harness path not substituted");
  assert.match(cfg, /plugin\.mjs/);

  const pkg = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
  assert.equal(pkg.name, "my-page");
});

test("scaffold refuses to overwrite without --force", () => {
  const target = join(mkdtempSync(join(tmpdir(), "artifact-scaffold-")), "p");
  execFileSync(process.execPath, [scaffold, target], { encoding: "utf8" });
  assert.throws(() => execFileSync(process.execPath, [scaffold, target], { stdio: "pipe" }));
});
