#!/usr/bin/env node
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, fail } from "./lib/args.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = resolve(here, "..", "template");

const { _, flags } = parseArgs(process.argv.slice(2));
const target = resolve(_[0] ?? fail('usage: scaffold.mjs <dir> [--title "Page Name"]'));

if (existsSync(target) && !flags.force) {
  fail(`${target} already exists. Pass --force to write into it anyway.`);
}

const title =
  flags.title ||
  basename(target)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

await mkdir(target, { recursive: true });
await cp(TEMPLATE, target, { recursive: true });

// The harness lives in the skill, not in the scaffolded project; point at it absolutely
// so the project works from anywhere without a workspace link.
const cfgPath = join(target, "vite.config.js");
const cfg = (await readFile(cfgPath, "utf8")).replace("__HARNESS_PATH__", join(here, "lib", "harness", "plugin.mjs"));
await writeFile(cfgPath, cfg);

const htmlPath = join(target, "index.html");
const html = (await readFile(htmlPath, "utf8")).replaceAll("__TITLE__", title);
await writeFile(htmlPath, html);

const pkgPath = join(target, "package.json");
const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
pkg.name = basename(target)
  .toLowerCase()
  .replace(/[^a-z0-9-]/g, "-");
await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

console.log(`Scaffolded "${title}" at ${target}

  cd ${target}
  npm install
  npm run dev      # HMR + theme/CSP/ground harness
  npm run build    # -> dist/artifact.html (one file, validated)
`);
