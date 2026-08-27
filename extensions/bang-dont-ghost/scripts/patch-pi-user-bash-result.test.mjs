import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { discoverInstalledPi, patchFile, patchSource } from "./patch-pi-user-bash-result.mjs";

const UNPATCHED_SOURCE = `class AgentSession {
    recordBashResult(bashMessage) {
        if (this.isStreaming) {
            this._pendingBashMessages.push(bashMessage);
        }
        else {
            this.agent.state.messages.push(bashMessage);
            // Save to session
            this.sessionManager.appendMessage(bashMessage);
        }
    }
    /**
     * Cancel running bash command.
     */
    abortBash() {}
    _flushPendingBashMessages() {
        for (const bashMessage of this._pendingBashMessages) {
            this.agent.state.messages.push(bashMessage);
            // Save to session
            this.sessionManager.appendMessage(bashMessage);
        }
        this._pendingBashMessages = [];
    }
}
`;

const BUNDLED_UNPATCHED_SOURCE =
  'class AgentSession{recordBashResult(command,result,options){let bashMessage={role:"bashExecution",command,output:result.output,excludeFromContext:options?.excludeFromContext};this.isStreaming?this._pendingBashMessages.push(bashMessage):(this.agent.state.messages.push(bashMessage),this.sessionManager.appendMessage(bashMessage))}abortBash(){}get hasPendingBashMessages(){return this._pendingBashMessages.length>0}_flushPendingBashMessages(){if(this._pendingBashMessages.length!==0){for(let bashMessage of this._pendingBashMessages)this.agent.state.messages.push(bashMessage),this.sessionManager.appendMessage(bashMessage);this._pendingBashMessages=[]}}}';

function createFakePackage(directory, { bundled }) {
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: bundled ? "0.84.3" : "0.84.2" }),
  );
  const distDirectory = join(directory, "dist");
  mkdirSync(distDirectory, { recursive: true });
  if (!bundled) {
    const cliPath = join(distDirectory, "cli.js");
    const targetPath = join(distDirectory, "core", "agent-session.js");
    mkdirSync(join(distDirectory, "core"));
    writeFileSync(cliPath, "#!/usr/bin/env node\n");
    writeFileSync(targetPath, UNPATCHED_SOURCE);
    return { cliPath, targetPath: realpathSync(targetPath) };
  }

  const bundleDirectory = join(distDirectory, "bundle");
  const chunksDirectory = join(bundleDirectory, "chunks");
  const cliPath = join(bundleDirectory, "cli.js");
  const targetPath = join(chunksDirectory, "chunk-runtime.js");
  mkdirSync(chunksDirectory, { recursive: true });
  writeFileSync(cliPath, 'import "./chunks/chunk-runtime.js";\n');
  writeFileSync(targetPath, BUNDLED_UNPATCHED_SOURCE);
  writeFileSync(join(chunksDirectory, "chunk-unrelated.js"), "export const unrelated = true;\n");
  return { cliPath, targetPath: realpathSync(targetPath) };
}

test("adds the result event after direct and deferred session appends", () => {
  const result = patchSource(UNPATCHED_SOURCE);
  assert.equal(result.state, "applied");
  assert.match(result.source, /type: "user_bash_result"/);
  assert.equal(result.source.match(/this\._emitUserBashResult\(bashMessage\)/g)?.length, 2);
  assert.ok(
    result.source.indexOf("this.sessionManager.appendMessage(bashMessage)") <
      result.source.indexOf("this._emitUserBashResult(bashMessage)"),
  );
});

test("patches a minified bundled runtime", () => {
  const result = patchSource(BUNDLED_UNPATCHED_SOURCE);
  assert.equal(result.state, "applied");
  assert.match(result.source, /type:"user_bash_result"/);
  assert.equal(result.source.match(/this\._emitUserBashResult\(bashMessage\)/g)?.length, 2);
  assert.equal(patchSource(result.source).state, "already-applied");
});

test("recognizes its own patch idempotently", () => {
  const first = patchSource(UNPATCHED_SOURCE);
  const second = patchSource(first.source);
  assert.equal(second.state, "already-applied");
  assert.equal(second.source, first.source);
});

test("rejects an unknown existing event implementation", () => {
  assert.throws(
    () => patchSource(`${UNPATCHED_SOURCE}\nconst event = { type: "user_bash_result" };\n`),
    /not in the expected patched shape/,
  );
});

test("rejects changed anchors without producing a partial patch", () => {
  const changed = UNPATCHED_SOURCE.replace("// Save to session", "// Changed upstream");
  assert.throws(() => patchSource(changed), /anchors did not match exactly once/);
});

test("discovers an unbundled Pi through a pnpm command shim", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-user-bash-result-discovery-test-"));
  try {
    const { cliPath, targetPath } = createFakePackage(directory, { bundled: false });
    const shimPath = join(directory, "pi");
    writeFileSync(shimPath, `#!/bin/sh\n# cmd-shim-target=${cliPath}\n`);
    assert.deepEqual(discoverInstalledPi(shimPath), {
      executable: shimPath,
      version: "0.84.2",
      targetPath,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("discovers the active chunk in a bundled Pi through a pnpm command shim", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-user-bash-result-discovery-test-"));
  try {
    const { cliPath, targetPath } = createFakePackage(directory, { bundled: true });
    const shimPath = join(directory, "pi");
    writeFileSync(shimPath, `#!/bin/sh\n# cmd-shim-target=${cliPath}\n`);
    assert.deepEqual(discoverInstalledPi(shimPath), {
      executable: shimPath,
      version: "0.84.3",
      targetPath,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("discovers Pi when its executable is a direct CLI symlink", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-user-bash-result-discovery-test-"));
  try {
    const { cliPath, targetPath } = createFakePackage(directory, { bundled: false });
    const symlinkPath = join(directory, "pi");
    symlinkSync(cliPath, symlinkPath);
    assert.deepEqual(discoverInstalledPi(symlinkPath), {
      executable: symlinkPath,
      version: "0.84.2",
      targetPath,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("writes a syntax-checked patch atomically", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-user-bash-result-patch-test-"));
  const target = join(directory, "agent-session.js");
  try {
    writeFileSync(target, UNPATCHED_SOURCE);
    assert.equal(patchFile(target), "applied");
    assert.equal(patchFile(target), "already-applied");
    assert.match(readFileSync(target, "utf8"), /type: "user_bash_result"/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
