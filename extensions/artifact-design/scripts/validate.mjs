#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs, fail } from "./lib/args.mjs";
import { validate, report } from "./lib/validate.mjs";

const { _ } = parseArgs(process.argv.slice(2));
const file = resolve(_[0] ?? fail("usage: validate.mjs <file.html>"));
if (!existsSync(file)) fail(`No such file: ${file}`);
console.log(`Validating ${file}`);
process.exit(report(validate(file)) ? 0 : 1);
