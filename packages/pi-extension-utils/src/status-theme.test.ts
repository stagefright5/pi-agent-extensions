import assert from "node:assert/strict";
import test from "node:test";
import { setThemedStatus, statusLineChannel, type StatusRenderer } from "./status-line.ts";

test("status storage stays plain; current theme is applied only by the renderer", () => {
	const statuses = new Map<string, string>();
	const ui = {
		setStatus(id: string, text: string | undefined) {
			if (text === undefined) statuses.delete(id);
			else statuses.set(id, text);
		},
	};
	const render: StatusRenderer = (theme) => theme.fg("warning", "Planning");
	try {
		setThemedStatus(ui, "test-status", render);
		assert.equal(statuses.get("test-status"), "Planning");
		const entry = statusLineChannel().themedStatuses!.get("test-status")!;
		assert.equal(entry.text, "Planning");
		assert.equal(entry.render({ fg: (_token, text) => `light:${text}` }), "light:Planning");
		assert.equal(entry.render({ fg: (_token, text) => `dark:${text}` }), "dark:Planning");
		const version = statusLineChannel().version!;
		setThemedStatus(ui, "test-status", (theme) => theme.fg("success", "Ready"));
		assert.ok(statusLineChannel().version! > version);
		assert.equal(statuses.get("test-status"), "Ready");
	} finally {
		setThemedStatus(ui, "test-status", undefined);
	}
	assert.equal(statuses.has("test-status"), false);
	assert.equal(statusLineChannel().themedStatuses!.has("test-status"), false);
});
