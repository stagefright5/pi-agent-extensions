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
test("effective legacy settings are read without rewriting Pi settings", (t) => {
	const dir = fixture(t);
	const path = join(dir, "settings.json");
	const effective = { theme: "dark", toolExplain: { model: "a/b", future: 42 } };
	const original = JSON.stringify(effective);
	writeFileSync(path, original);
	saveSelection({ tools: ["bash"], excludeTools: [] }, dir);
	assert.equal(readFileSync(path, "utf8"), original);
	assert.deepEqual(loadSettings(dir, effective), {
		model: { provider: "a", id: "b" },
		tools: ["bash"],
		excludeTools: [],
	});
	assert.deepEqual(loadSettings(dir, { codemodeExplain: { model: "legacy/model" } }).model, {
		provider: "legacy",
		id: "model",
	});
});
test("standalone model and unknown fields survive selection changes", (t) => {
	const dir = fixture(t);
	const path = join(dir, "tool-explain.json");
	writeFileSync(path, JSON.stringify({ model: "a/b", future: 42 }));
	saveSelection({ tools: [], excludeTools: [] }, dir);
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { model: "a/b", future: 42, tools: [], excludeTools: [] });
});
test("invalid private files are reported and never overwritten", (t) => {
	const dir = fixture(t);
	const path = join(dir, "tool-explain.json");
	for (const bad of ["{oops", "null", "[]", '{"tools":false}', '{"tools":[42]}', '{"excludeTools":"bash"}']) {
		writeFileSync(path, bad);
		assert.throws(() => loadSettings(dir));
		assert.throws(() => saveSelection({ tools: "all", excludeTools: [] }, dir));
		assert.equal(readFileSync(path, "utf8"), bad);
	}
	assert.throws(() => loadSettings(fixture(t), { toolExplain: false }));
});
