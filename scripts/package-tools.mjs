#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
const marker = (name, edge) => `<!-- package-tools:${name}:${edge} -->`;

export function replaceBlock(text, name, body) {
  const start = marker(name, "start");
  const end = marker(name, "end");
  assert.equal(text.split(start).length, 2, `Expected one ${start}`);
  assert.equal(text.split(end).length, 2, `Expected one ${end}`);
  const from = text.indexOf(start) + start.length;
  const to = text.indexOf(end);
  assert.ok(to > from, `Reversed ${name} markers`);
  return `${text.slice(0, from)}\n\n${body}\n\n${text.slice(to)}`;
}

export function loadWorkspace(root = ROOT) {
  const manifest = json(join(root, "package.json"));
  const { baseBranch: branch, access } = json(join(root, ".changeset/config.json"));
  assert.ok(manifest.license && manifest.repository?.url && branch, "Missing shared publication defaults");
  assert.ok(["public", "restricted"].includes(access), "Missing Changesets publication access");
  const repositoryUrl = manifest.repository.url.replace(/^git\+/, "").replace(/\.git$/, "");
  const packages = readdirSync(join(root, "extensions"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, "extensions", entry.name, "package.json")))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ name: slug }) => {
      const directory = `extensions/${slug}`;
      const dir = join(root, directory);
      const source = json(join(dir, "package.json"));
      const metadata = source.packageTools;
      assert.ok(
        source.name && source.version && source.description && source.type,
        `Incomplete manifest: ${directory}`,
      );
      assert.ok(metadata?.title && metadata?.interface, `Missing packageTools catalogue metadata: ${directory}`);
      assert.ok(source.pi?.extensions?.length || source.pi?.skills?.length, `Missing Pi resources: ${directory}`);
      assert.equal(
        source.publishConfig?.directory,
        `../../.tmp/publish/${slug}`,
        `Incorrect staging path: ${directory}`,
      );
      assert.equal(source.publishConfig.linkDirectory, false, `Workspace links must use source: ${directory}`);
      return { slug, directory, dir, source, metadata };
    });
  assert.ok(packages.length, "No workspace packages found");
  assert.equal(new Set(packages.map((pkg) => pkg.source.name)).size, packages.length, "Duplicate package names");
  return { root, manifest, repositoryUrl, branch, access, packages };
}

const cell = (value) => value.replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ");

export function renderCatalogue(packages) {
  const rows = [
    ["Workspace", "npm package", "Purpose", "Primary interface"],
    ...packages.map(({ directory, source, metadata }) => [
      `[${cell(metadata.title)}](./${directory}/README.md)`,
      `\`${source.name}\``,
      cell(source.description),
      cell(metadata.interface),
    ]),
  ];
  const widths = rows[0].map((_, index) => Math.max(...rows.map((row) => row[index].length)));
  const line = (row) => `| ${row.map((value, index) => value.padEnd(widths[index])).join(" | ")} |`;
  // Preserve deterministic padding across Markdown formatter versions.
  return `<!-- prettier-ignore -->\n${[line(rows[0]), line(widths.map((width) => "-".repeat(width))), ...rows.slice(1).map(line)].join("\n")}`;
}

export function renderPiManifest(packages) {
  const pi = {};
  for (const { directory, source } of packages) {
    for (const [kind, paths] of Object.entries(source.pi)) {
      assert.ok(Array.isArray(paths), `Unsupported Pi resource field: ${kind}`);
      pi[kind] ??= [];
      for (const path of paths) {
        // These manifests deliberately use explicit paths, not globs or exclusions.
        assert.ok(path.startsWith("./") && !/[*!?{}]/.test(path), `Expected explicit Pi path: ${path}`);
        const rebased = posix.normalize(`${directory}/${path}`);
        assert.ok(rebased.startsWith(`${directory}/`), `Pi path escapes package: ${path}`);
        pi[kind].push(`./${rebased}`);
      }
    }
  }
  return pi;
}

function installation(pkg, workspace) {
  let block = `## Installation\n\nInstall the standalone package:\n\n\`\`\`bash\npi install npm:${pkg.source.name}\n\`\`\``;
  if (workspace) {
    block += `\n\nFor source development and tests, see the [source README](${sourceUrl(workspace, `${pkg.directory}/README.md`)}) and [workspace development guide](${sourceUrl(workspace, "README.md")}#local-development).`;
  }
  return block;
}

export function syncWorkspace(workspace, { check = false } = {}) {
  const { root, manifest, packages } = workspace;
  const updates = [];
  const pi = renderPiManifest(packages);
  if (JSON.stringify(manifest.pi) !== JSON.stringify(pi)) {
    updates.push([join(root, "package.json"), serialize({ ...manifest, pi })]);
  }
  const readmePath = join(root, "README.md");
  const readme = readFileSync(readmePath, "utf8");
  let next = replaceBlock(readme, "catalogue", renderCatalogue(packages));
  next = replaceBlock(
    next,
    "install",
    `\`\`\`bash\n${packages.map(({ source }) => `pi install npm:${source.name}`).join("\n")}\n\`\`\``,
  );
  if (next !== readme) updates.push([readmePath, next]);
  for (const pkg of packages) {
    const path = join(pkg.dir, "README.md");
    const before = readFileSync(path, "utf8");
    const after = replaceBlock(before, "install", installation(pkg));
    if (before !== after) updates.push([path, after]);
  }
  if (check && updates.length) {
    throw new Error(
      `Generated indexes are stale. Run pnpm run packages:sync:\n${updates.map(([path]) => relative(root, path)).join("\n")}`,
    );
  }
  if (!check) for (const [path, text] of updates) writeFileSync(path, text);
  return updates.map(([path]) => relative(root, path));
}

function sourceUrl(workspace, path) {
  return `${workspace.repositoryUrl}/blob/${encodeURIComponent(workspace.branch)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function publishedReadme(workspace, pkg) {
  let text = replaceBlock(readFileSync(join(pkg.dir, "README.md"), "utf8"), "install", installation(pkg, workspace));
  // Only transform prose: examples inside fenced code blocks must stay verbatim.
  let fence;
  text = text
    .split("\n")
    .map((line) => {
      const match = line.match(/^\s*(`{3,}|~{3,})/);
      if (match) {
        if (!fence) fence = match[1];
        else if (match[1][0] === fence[0] && match[1].length >= fence.length) fence = undefined;
        return line;
      }
      if (fence) return line;
      if (line.startsWith("For source development,")) return undefined;
      return line.replace(/\]\(([^\s)]+)\)/g, (original, href) => {
        if (/^(?:[a-z][a-z\d+.-]*:|#|\/)/i.test(href)) return original;
        const [, path, suffix] = href.match(/^([^?#]*)(.*)$/);
        const target = posix.normalize(`${pkg.directory}/${path}`);
        assert.ok(!target.startsWith("../"), `README link escapes repository: ${href}`);
        return `](${sourceUrl(workspace, target)}${suffix})`;
      });
    })
    .filter((line) => line !== undefined)
    .join("\n");
  return text;
}

function excluded(path) {
  return (
    path.split("/").some((part) => ["node_modules", "tests", "__tests__", ".git", "dist", "coverage"].includes(part)) ||
    /(?:^|\/)[^/]+\.(?:test|spec)\.[^/]+$/.test(path) ||
    path.split("/").some((part) => part.startsWith(".") && part !== ".gitignore")
  );
}

export function publicationFiles(pkg) {
  const roots = readdirSync(pkg.dir).filter(
    (name) => /\.(?:ts|js|mjs|cjs)$/.test(name) || ["README.md", "CHANGELOG.md", "SKILL.md"].includes(name),
  );
  // Skill runtime assets follow these conventions. Extension-only development scripts do not ship.
  if (pkg.source.pi.skills?.length) {
    for (const name of ["references", "scripts", "template"]) {
      if (existsSync(join(pkg.dir, name))) roots.push(name);
    }
  }
  for (const path of pkg.metadata.include ?? []) roots.push(path);
  const files = new Set();
  function walk(path) {
    assert.ok(
      typeof path === "string" && path && !isAbsolute(path) && !path.includes("\\") && !path.split("/").includes(".."),
      `Unsafe publication path: ${path}`,
    );
    if (
      excluded(path) ||
      (pkg.metadata.exclude ?? []).some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
    )
      return;
    let input = pkg.dir;
    for (const part of path.split("/")) {
      input = join(input, part);
      assert.ok(!lstatSync(input).isSymbolicLink(), `Publication inputs must not be symlinks: ${path}`);
    }
    const stat = lstatSync(input);
    if (stat.isDirectory()) {
      for (const name of readdirSync(join(pkg.dir, path))) walk(`${path}/${name}`);
    } else {
      assert.ok(stat.isFile(), `Not a regular publication input: ${path}`);
      assert.ok(!["package.json", "LICENSE"].includes(path), `Reserved generated file: ${path}`);
      files.add(path);
    }
  }
  for (const path of roots) walk(path);
  return [...files].sort();
}

export function publicationManifest(workspace, pkg, files) {
  const source = pkg.source;
  const keywords = new Set([
    "pi-package",
    ...(source.pi.extensions?.length ? ["pi-extension"] : []),
    ...(source.pi.skills?.length ? ["pi-skill"] : []),
    ...(source.keywords ?? []),
  ]);
  const manifest = {
    name: source.name,
    version: source.version,
    description: source.description,
    license: workspace.manifest.license,
    type: source.type,
    keywords: [...keywords],
    files: ["LICENSE", ...files],
    repository: { ...workspace.manifest.repository, directory: pkg.directory },
  };
  // Development scripts, catalog dependencies and staging metadata must never leak into npm manifests.
  for (const key of [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
    "peerDependenciesMeta",
    "engines",
    "os",
    "cpu",
    "bin",
    "main",
    "module",
    "exports",
    "imports",
    "types",
    "pi",
  ]) {
    if (source[key] !== undefined) manifest[key] = source[key];
  }
  for (const key of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    for (const version of Object.values(manifest[key] ?? {})) {
      assert.ok(
        !/^(?:catalog:|workspace:|link:|file:)/.test(version),
        `Resolve ${key} before publishing ${source.name}: ${version}`,
      );
    }
  }
  manifest.publishConfig = { access: workspace.access };
  return manifest;
}

export function stagePackage(workspace, pkg) {
  const files = publicationFiles(pkg);
  const manifest = publicationManifest(workspace, pkg, files);
  for (const paths of Object.values(manifest.pi)) {
    for (const path of paths)
      assert.ok(files.includes(path.replace(/^\.\//, "")), `Missing published Pi resource: ${path}`);
  }
  const destination = join(workspace.root, ".tmp", "publish", pkg.slug);
  // This directory is owned exclusively by this generator. Remove stale outputs on every build.
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  for (const file of files) {
    const target = join(destination, file);
    mkdirSync(dirname(target), { recursive: true });
    if (file === "README.md") writeFileSync(target, publishedReadme(workspace, pkg));
    else copyFileSync(join(pkg.dir, file), target);
  }
  copyFileSync(join(workspace.root, "LICENSE"), join(destination, "LICENSE"));
  writeFileSync(join(destination, "package.json"), serialize(manifest));
  return destination;
}

export function main(command, root = ROOT, cwd = process.cwd()) {
  assert.ok(
    ["sync", "check", "stage", "stage-package"].includes(command),
    "Usage: package-tools.mjs <sync|check|stage|stage-package>",
  );
  const workspace = loadWorkspace(root);
  syncWorkspace(workspace, { check: command !== "sync" });
  if (command === "stage" || command === "stage-package") {
    const packages =
      command === "stage" ? workspace.packages : workspace.packages.filter((pkg) => pkg.dir === resolve(cwd));
    assert.ok(packages.length, "stage-package must run from a workspace package directory");
    for (const pkg of packages) stagePackage(workspace, pkg);
    console.log(`Staged ${packages.length} package(s) in .tmp/publish/`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv[2]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
