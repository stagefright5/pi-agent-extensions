import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SUPPORTED_PI_VERSION, discoverInstalledPi, patchFile, patchSource } from "./patch-pi-user-bash-result.mjs";

const UNPATCHED_SOURCE =
  'class AgentSession{recordBashResult(command,result,options){let bashMessage={role:"bashExecution",command,output:result.output,exitCode:result.exitCode,cancelled:result.cancelled,truncated:result.truncated,fullOutputPath:result.fullOutputPath,timestamp:Date.now(),excludeFromContext:options?.excludeFromContext};this.isStreaming?this._pendingBashMessages.push(bashMessage):(this.sessionManager.appendMessage(bashMessage),this._refreshFinalizedContext())}abortBash(){}get hasPendingBashMessages(){return this._pendingBashMessages.length>0}_flushPendingBashMessages(){if(this._pendingBashMessages.length!==0){for(let bashMessage of this._pendingBashMessages)this.sessionManager.appendMessage(bashMessage);this._pendingBashMessages=[],this._refreshFinalizedContext()}}}';

function createFakePackage(directory, version = SUPPORTED_PI_VERSION) {
  writeFileSync(join(directory, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version }));
  const bundleDirectory = join(directory, "dist", "bundle");
  const chunksDirectory = join(bundleDirectory, "chunks");
  const cliPath = join(bundleDirectory, "cli.js");
  const targetPath = join(chunksDirectory, "chunk-runtime.js");
  mkdirSync(chunksDirectory, { recursive: true });
  writeFileSync(cliPath, 'import "./chunks/chunk-runtime.js";\n');
  writeFileSync(targetPath, UNPATCHED_SOURCE);
  writeFileSync(join(chunksDirectory, "chunk-unrelated.js"), "export const unrelated = true;\n");
  return { cliPath, targetPath: realpathSync(targetPath) };
}

test("patches the Pi 0.87.0 bundled runtime after context refresh", () => {
  const result = patchSource(UNPATCHED_SOURCE);
  assert.equal(result.state, "applied");
  assert.match(result.source, /type:"user_bash_result"/);
  assert.equal(result.source.match(/this\._emitUserBashResult\(bashMessage\)/g)?.length, 2);
  assert.match(result.source, /this\._refreshFinalizedContext\(\),this\._emitUserBashResult\(bashMessage\)/);
  assert.match(
    result.source,
    /this\._pendingBashMessages=\[\],this\._refreshFinalizedContext\(\);for\(let bashMessage of bashMessages\)this\._emitUserBashResult/,
  );
});

test("recognizes the Pi 0.87.0 patch idempotently", () => {
  const first = patchSource(UNPATCHED_SOURCE);
  const second = patchSource(first.source);
  assert.equal(second.state, "already-applied");
  assert.equal(second.source, first.source);
});

test("rejects an unknown existing event implementation", () => {
  assert.throws(
    () => patchSource(`${UNPATCHED_SOURCE}\nconst event = { type: "user_bash_result" };\n`),
    /not in the expected Pi 0\.87\.0 patch shape/,
  );
});

test("rejects changed Pi 0.87.0 anchors without producing a partial patch", () => {
  const changed = UNPATCHED_SOURCE.replace(
    "this.sessionManager.appendMessage(bashMessage),this._refreshFinalizedContext()",
    "this.sessionManager.appendMessage(bashMessage)",
  );
  assert.throws(() => patchSource(changed), /direct=0, deferred=1/);
  assert.doesNotMatch(changed, /user_bash_result/);
});

test("discovers Pi 0.87.0 through its pnpm command shim", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-user-bash-result-discovery-test-"));
  try {
    const { cliPath, targetPath } = createFakePackage(directory);
    const shimPath = join(directory, "pi");
    writeFileSync(shimPath, `#!/bin/sh\n# cmd-shim-target=${cliPath}\n`);
    assert.deepEqual(discoverInstalledPi(shimPath), {
      executable: shimPath,
      version: SUPPORTED_PI_VERSION,
      targetPath,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("discovers Pi 0.87.0 when its executable is a bundled CLI symlink", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-user-bash-result-discovery-test-"));
  try {
    const { cliPath, targetPath } = createFakePackage(directory);
    const symlinkPath = join(directory, "pi");
    symlinkSync(cliPath, symlinkPath);
    assert.deepEqual(discoverInstalledPi(symlinkPath), {
      executable: symlinkPath,
      version: SUPPORTED_PI_VERSION,
      targetPath,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects Pi version drift", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-user-bash-result-discovery-test-"));
  try {
    const { cliPath } = createFakePackage(directory, "0.87.1");
    assert.throws(() => discoverInstalledPi(cliPath), /only supports 0\.87\.0/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects a non-bundled Pi CLI layout", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-user-bash-result-discovery-test-"));
  try {
    const cliPath = join(directory, "dist", "cli.js");
    mkdirSync(join(directory, "dist"), { recursive: true });
    writeFileSync(cliPath, "#!/usr/bin/env node\n");
    assert.throws(() => discoverInstalledPi(cliPath), /not a supported Pi 0\.87\.0 command shim/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("writes a syntax-checked Pi 0.87.0 patch atomically", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-user-bash-result-patch-test-"));
  const target = join(directory, "runtime.js");
  try {
    writeFileSync(target, UNPATCHED_SOURCE);
    assert.equal(patchFile(target), "applied");
    assert.equal(patchFile(target), "already-applied");
    assert.match(readFileSync(target, "utf8"), /type:"user_bash_result"/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
