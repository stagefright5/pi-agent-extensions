import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  loadWorkspace,
  main,
  publicationFiles,
  publicationManifest,
  publishedReadme,
  renderPiManifest,
  replaceBlock,
  stagePackage,
  syncWorkspace,
} from "./package-tools.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(path, "utf8");
const json = (path) => JSON.parse(read(path));
const saveJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-packages-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of [
    "package.json",
    "README.md",
    "LICENSE",
    ".changeset",
    "pnpm-workspace.yaml",
    "scripts",
    "extensions",
  ]) {
    cpSync(join(ROOT, path), join(root, path), {
      recursive: true,
      filter: (source) => !source.split(/[\\/]/).includes("node_modules") && !source.endsWith(".tgz"),
    });
  }
  return loadWorkspace(root);
}

function get(workspace, slug) {
  return workspace.packages.find((pkg) => pkg.slug === slug);
}

test("checked-in indexes are current and sync is idempotent", () => {
  const workspace = loadWorkspace();
  assert.deepEqual(syncWorkspace(workspace, { check: true }), []);
  const pi = renderPiManifest(workspace.packages);
  assert.equal(pi.extensions.length, 9);
  assert.deepEqual(pi.skills, [
    "./extensions/artifact-design/SKILL.md",
    "./extensions/jenkins-cli-operations/SKILL.md",
  ]);
  for (const paths of Object.values(pi)) for (const path of paths) assert.ok(existsSync(join(ROOT, path)));
});

test("check detects drift without writing; sync repairs all indexes without changing authored prose", (t) => {
  const workspace = fixture(t);
  const pkg = get(workspace, "ask");
  pkg.source.name = "@example/renamed-ask";
  pkg.source.description = "Updated | purpose";
  workspace.manifest.pi = {};
  const readme = join(workspace.root, "README.md");
  const before = read(readme);
  assert.throws(() => syncWorkspace(workspace, { check: true }), /Generated indexes are stale/);
  assert.equal(read(readme), before);
  assert.deepEqual(
    syncWorkspace(workspace).map((path) => path.split(/[\\/]/).join("/")),
    ["package.json", "README.md", "extensions/ask/README.md"],
  );
  assert.match(read(readme), /Updated \\\| purpose/);
  assert.match(read(join(pkg.dir, "README.md")), /pi install npm:@example\/renamed-ask/);
  assert.match(read(join(pkg.dir, "README.md")), /For source development, load this directory/);
  workspace.manifest = json(join(workspace.root, "package.json"));
  assert.deepEqual(syncWorkspace(workspace), []);
  assert.equal(read(readme).split("## Local development")[1], before.split("## Local development")[1]);
});

test("generation fails closed on missing markers and unsafe resource paths", () => {
  assert.throws(() => replaceBlock("authored prose", "install", "generated"), /Expected one/);
  assert.throws(() => replaceBlock("<!-- package-tools:x:end --><!-- package-tools:x:start -->", "x", ""), /Reversed/);
  assert.throws(
    () => renderPiManifest([{ directory: "extensions/x", source: { pi: { extensions: ["./../secret.ts"] } } }]),
    /escapes package/,
  );
  assert.throws(
    () => renderPiManifest([{ directory: "extensions/x", source: { pi: { extensions: ["./*.ts"] } } }]),
    /explicit Pi path/,
  );
});

test("all staged packages carry shared defaults, unchanged release identity, and only runtime resources", (t) => {
  const workspace = fixture(t);
  for (const pkg of workspace.packages) {
    const destination = stagePackage(workspace, pkg);
    const manifest = json(join(destination, "package.json"));
    assert.equal(manifest.name, pkg.source.name);
    assert.equal(manifest.version, pkg.source.version);
    assert.equal(manifest.license, workspace.manifest.license);
    assert.equal(read(join(destination, "LICENSE")), read(join(workspace.root, "LICENSE")));
    assert.equal(existsSync(join(pkg.dir, "LICENSE")), false);
    assert.deepEqual(manifest.repository, { ...workspace.manifest.repository, directory: pkg.directory });
    assert.deepEqual(manifest.pi, pkg.source.pi);
    assert.deepEqual(manifest.peerDependencies, pkg.source.peerDependencies);
    assert.deepEqual(manifest.publishConfig, { access: "public" });
    assert.equal(manifest.scripts, undefined);
    assert.equal(manifest.devDependencies, undefined);
    assert.equal(manifest.packageTools, undefined);
    assert.ok(manifest.keywords.includes("pi-package"));
    assert.ok(manifest.keywords.includes(pkg.source.pi.skills ? "pi-skill" : "pi-extension"));
    assert.equal(pkg.source.scripts.prepack, "node ../../scripts/package-tools.mjs stage-package");
    for (const file of manifest.files) {
      assert.ok(existsSync(join(destination, file)), `${pkg.slug}: missing ${file}`);
      assert.doesNotMatch(file, /(?:^|\/)tests\/|\.(test|spec)\.|node_modules/);
      if (/\.(ts|mjs|js)$/.test(file)) {
        for (const [, path] of read(join(destination, file)).matchAll(/(?:from\s+|import\s*)["'](\.[^"']+)["']/g)) {
          assert.ok(
            existsSync(resolve(destination, dirname(file), path)),
            `${pkg.slug}: missing import ${file} -> ${path}`,
          );
        }
      }
    }
    const readme = read(join(destination, "README.md"));
    assert.ok(readme.includes(`pi install npm:${pkg.source.name}`));
    assert.doesNotMatch(readme, /\]\(\.\.\/\.\.\/README.md\)|For source development, load this directory/);
  }
  const artifact = join(workspace.root, ".tmp/publish/artifact-design");
  for (const path of [
    "template/.gitignore",
    "template/package.json",
    "scripts/lib/harness/client.css",
    "scripts/lib/harness/client.js",
    "references/FUNDAMENTALS.md",
  ]) {
    assert.ok(existsSync(join(artifact, path)), `Missing artifact resource: ${path}`);
  }
  assert.ok(!existsSync(join(workspace.root, ".tmp/publish/bang-dont-ghost/scripts")));
  assert.ok(existsSync(join(workspace.root, ".tmp/publish/plan-mode/utils.ts")));
});

test("staging removes stale output, preserves source, and supports safe package-local exceptions", (t) => {
  const workspace = fixture(t);
  const pkg = get(workspace, "ask");
  const sourceBefore = read(join(pkg.dir, "package.json"));
  writeFileSync(join(pkg.dir, "old-helper.js"), "export const value = 1;\n");
  const destination = stagePackage(workspace, pkg);
  assert.ok(existsSync(join(destination, "old-helper.js")));
  unlinkSync(join(pkg.dir, "old-helper.js"));
  writeFileSync(join(pkg.dir, "extra.txt"), "runtime resource");
  pkg.metadata.include = ["extra.txt"];
  pkg.metadata.exclude = ["ask-prompt.ts"];
  stagePackage(workspace, pkg);
  assert.ok(!existsSync(join(destination, "old-helper.js")));
  assert.ok(!existsSync(join(destination, "ask-prompt.ts")));
  assert.equal(read(join(destination, "extra.txt")), "runtime resource");
  assert.equal(read(join(pkg.dir, "package.json")), sourceBefore);
  pkg.metadata.include = ["../secret"];
  assert.throws(() => publicationFiles(pkg), /Unsafe publication path/);
  pkg.metadata.include = ["leak"];
  symlinkSync(join(workspace.root, "LICENSE"), join(pkg.dir, "leak"));
  assert.throws(() => publicationFiles(pkg), /must not be symlinks/);
  symlinkSync(workspace.root, join(pkg.dir, "parent-leak"));
  pkg.metadata.include = ["parent-leak/LICENSE"];
  assert.throws(() => publicationFiles(pkg), /must not be symlinks/);
});

test("staging rejects missing entry points and unresolved runtime dependency protocols", (t) => {
  const workspace = fixture(t);
  const pkg = get(workspace, "ask");
  pkg.source.dependencies = { runtime: "catalog:" };
  assert.throws(() => publicationManifest(workspace, pkg, []), /Resolve dependencies/);
  pkg.source.dependencies = { runtime: "^1.0.0" };
  assert.deepEqual(publicationManifest(workspace, pkg, []).dependencies, pkg.source.dependencies);
  workspace.access = "restricted";
  assert.deepEqual(publicationManifest(workspace, pkg, []).publishConfig, { access: "restricted" });
  pkg.metadata.exclude = ["index.ts"];
  assert.throws(() => stagePackage(workspace, pkg), /Missing published Pi resource/);
});

test("published README rewrites repository links, preserves usage and leaves code examples untouched", (t) => {
  const workspace = fixture(t);
  const pkg = get(workspace, "ask");
  const path = join(pkg.dir, "README.md");
  writeFileSync(
    path,
    `${read(path)}\n[helper](./ask-prompt.ts#example) [external](https://example.org) [anchor](#usage)\n\n\`\`\`md\n[example](./leave-this-alone.md)\nFor source development, keep this example verbatim.\n\`\`\`\n`,
  );
  const before = read(path);
  const published = publishedReadme(workspace, pkg);
  assert.ok(published.includes(`${workspace.repositoryUrl}/blob/main/extensions/ask/ask-prompt.ts#example`));
  assert.ok(published.includes(`${workspace.repositoryUrl}/blob/main/README.md`));
  assert.ok(published.includes("[external](https://example.org) [anchor](#usage)"));
  assert.ok(published.includes("[example](./leave-this-alone.md)"));
  assert.ok(published.includes("For source development, keep this example verbatim."));
  assert.equal(
    published.split("## Usage")[1].split("<!-- package-tools:install:start -->")[0],
    before.split("## Usage")[1].split("<!-- package-tools:install:start -->")[0],
  );
  assert.equal(read(path), before);
});

test("stage-package rejects unrelated directories and stale indexes", (t) => {
  const workspace = fixture(t);
  assert.throws(() => main("stage-package", workspace.root, workspace.root), /must run from a workspace package/);
  const pkg = get(workspace, "ask");
  pkg.source.description = "drift";
  saveJson(join(pkg.dir, "package.json"), pkg.source);
  assert.throws(() => main("stage-package", workspace.root, pkg.dir), /Generated indexes are stale/);
  assert.ok(!existsSync(join(workspace.root, ".tmp/publish/ask")));
});

test("pnpm packs every source package through prepack and publishConfig.directory without publishing", (t) => {
  const workspace = fixture(t);
  const output = join(workspace.root, ".tmp/tarballs");
  mkdirSync(output, { recursive: true });
  for (const pkg of workspace.packages) {
    const tarball = join(output, `${pkg.slug}.tgz`);
    execFileSync("pnpm", ["--dir", pkg.dir, "pack", "--out", tarball], { encoding: "utf8", stdio: "pipe" });
    const manifest = JSON.parse(execFileSync("tar", ["-xOf", tarball, "package/package.json"], { encoding: "utf8" }));
    const files = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" }).trim().split("\n");
    const expected = ["package.json", ...publicationManifest(workspace, pkg, publicationFiles(pkg)).files]
      .map((file) => `package/${file}`)
      .sort();
    assert.deepEqual(files.sort(), expected, `${pkg.slug}: tarball differs from staging policy`);
    assert.equal(manifest.packageTools, undefined);
    assert.equal(manifest.scripts, undefined);
    assert.equal(manifest.devDependencies, undefined);
    assert.deepEqual(manifest.publishConfig, { access: "public" });
    assert.equal(manifest.version, pkg.source.version);
    assert.equal(
      execFileSync("tar", ["-xOf", tarball, "package/LICENSE"], { encoding: "utf8" }),
      read(join(workspace.root, "LICENSE")),
    );
  }
});
