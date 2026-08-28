#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs, fail } from "./lib/args.mjs";

const { _, flags } = parseArgs(process.argv.slice(2));
const root = resolve(_[0] ?? process.cwd());
if (!existsSync(join(root, "vite.config.js"))) {
  fail(`No vite.config.js in ${root}. Run scaffold.mjs first, or pass the project dir.`);
}

const { createServer } = await import("vite");
const server = await createServer({
  root,
  server: { port: Number(flags.port) || 5173, strictPort: false, open: Boolean(flags.open) },
});
await server.listen();
server.printUrls();
console.log("\n  harness: theme tri-state + host-ground toggle, bottom right");
console.log("  CSP:     dev policy sent on every response (relaxed for HMR only)");
console.log("  agent:   window.artifactAgent (window.claude aliased)\n");
