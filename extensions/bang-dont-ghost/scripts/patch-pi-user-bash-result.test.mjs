import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { patchFile, patchSource } from "./patch-pi-user-bash-result.mjs";

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
