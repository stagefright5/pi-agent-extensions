import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enabled, loadSettings, saveSelection } from "./settings.ts";

function fixture(t: { after(fn: () => void): void }) {
	const dir = mkdtempSync(join(tmpdir(), "tool-explain-settings-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

test("defaults to all, supports exclusions, allowlists and disabling everything", (t) => {
	const dir = fixture(t);
	assert.equal(enabled(loadSettings(dir), "mcp__future__tool"), true);
	saveSelection({ tools: "all", excludeTools: ["read"] }, dir);
	assert.equal(enabled(loadSettings(dir), "read"), false);
	assert.equal(enabled(loadSettings(dir), "bash"), true);
	saveSelection({ tools: ["codemode", "bash"], excludeTools: [] }, dir);
	assert.equal(enabled(loadSettings(dir), "bash"), true);
	assert.equal(enabled(loadSettings(dir), "read"), false);
	saveSelection({ tools: [], excludeTools: [] }, dir);
	assert.equal(enabled(loadSettings(dir), "codemode"), false);
});

test("selection round-trips without losing the model, unknown fields or other Pi settings", (t) => {
	const dir = fixture(t);
	const path = join(dir, "settings.json");
	writeFileSync(path, JSON.stringify({ theme: "dark", toolExplain: { model: "a/b", future: 42 } }));
	saveSelection({ tools: ["bash"], excludeTools: [] }, dir);
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), {
		theme: "dark",
		toolExplain: { model: "a/b", future: 42, tools: ["bash"], excludeTools: [] },
	});
	assert.deepEqual(loadSettings(dir).model, { provider: "a", id: "b" });
});

test("invalid files are reported and never overwritten", (t) => {
	const dir = fixture(t);
	const path = join(dir, "settings.json");
	for (const bad of ["{oops", "null", "[]", '{"toolExplain":false}']) {
		writeFileSync(path, bad);
		assert.throws(() => loadSettings(dir));
		assert.throws(() => saveSelection({ tools: "all", excludeTools: [] }, dir));
		assert.equal(readFileSync(path, "utf8"), bad);
	}
	for (const value of [{ tools: false }, { tools: [42] }, { excludeTools: "bash" }]) {
		writeFileSync(path, JSON.stringify({ toolExplain: value }));
		assert.throws(() => loadSettings(dir));
	}
});
