import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	readJsonFile,
	writeJsonFile,
	registerStatusAction,
	registerModelStatus,
	statusLineChannel,
	recordExtensionUsage,
	EXTENSION_USAGE_TYPE,
} from "./index.ts";

test("private atomic JSON storage fails closed on unreadable documents", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "pi-utils-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, "nested", "state.json");
	assert.equal(readJsonFile(path), undefined);
	writeJsonFile(path, { enabled: true });
	assert.deepEqual(readJsonFile(path), { enabled: true });
	if (process.platform !== "win32") {
		assert.equal(statSync(path).mode & 0o777, 0o600);
		assert.equal(statSync(join(dir, "nested")).mode & 0o777, 0o700);
	}
	writeFileSync(path, "{broken");
	assert.throws(() => readJsonFile(path));
	assert.equal(readFileSync(path, "utf8"), "{broken");
});

test("status contract shares actions and presentation without coupling ids", () => {
	const remove = registerStatusAction("sample", { label: "open", activate() {} });
	const replacement = { label: "next", activate() {} };
	const removeReplacement = registerStatusAction("sample", replacement);
	remove();
	assert.equal(statusLineChannel().statusActions?.get("sample"), replacement);
	const detach = registerModelStatus("sample");
	assert.equal(statusLineChannel().modelStatuses?.has("sample"), true);
	detach();
	removeReplacement();
	assert.equal(statusLineChannel().modelStatuses?.has("sample"), false);
});

test("nested usage is stored durably, not in model context", () => {
	const entries: unknown[] = [];
	const pi = { appendEntry: (...args: unknown[]) => entries.push(args) };
	recordExtensionUsage(pi as never, "summary", undefined);
	assert.deepEqual(entries, []);
	const usage = { cost: { total: 1 } };
	recordExtensionUsage(pi as never, "summary", usage as never);
	assert.deepEqual(entries, [[EXTENSION_USAGE_TYPE, { source: "summary", usage }]]);
});
