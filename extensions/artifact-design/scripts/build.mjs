#!/usr/bin/env node
import { existsSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs, fail } from "./lib/args.mjs";
import { validate, report } from "./lib/validate.mjs";

const { _, flags } = parseArgs(process.argv.slice(2));
const root = resolve(_[0] ?? process.cwd());
if (!existsSync(join(root, "vite.config.js"))) {
  fail(`No vite.config.js in ${root}. Run scaffold.mjs first, or pass the project dir.`);
}

const { build } = await import("vite");
await build({ root, logLevel: flags.verbose ? "info" : "warn" });

const out = join(root, "dist", "index.html");
const named = join(root, "dist", "artifact.html");
if (!existsSync(out)) fail("Build produced no dist/index.html.");
renameSync(out, named);

console.log(`\nBuilt ${named}`);
const ok = report(validate(named));
if (!ok) {
  console.error("\nRefusing to call this publishable. Fix the errors above.");
  process.exit(1);
}
console.log("\nPublish with the Artifact tool pointed at this file.");
