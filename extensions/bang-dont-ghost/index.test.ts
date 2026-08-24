import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import bangDontGhostExtension, { createEmptyFollowUpRequest, type UserBashResultEvent } from "./index.ts";

function resultEvent(
	options: {
		command?: string;
		excludeFromContext?: boolean;
		cancelled?: boolean;
		exitCode?: number;
	} = {},
): UserBashResultEvent {
	return {
		type: "user_bash_result",
		command: options.command ?? "npm test",
		excludeFromContext: options.excludeFromContext ?? false,
		result: {
			output: "output",
			exitCode: options.exitCode ?? 0,
			cancelled: options.cancelled ?? false,
			truncated: false,
		},
	};
}

function setupExtension(): {
	eventName: string;
	emit: (event: UserBashResultEvent) => void;
	sent: Array<{ message: unknown; options: unknown }>;
} {
	let eventName = "";
	let handler: ((event: UserBashResultEvent) => void) | undefined;
	const sent: Array<{ message: unknown; options: unknown }> = [];
	const pi = {
		on(event: string, registeredHandler: (event: UserBashResultEvent) => void) {
			eventName = event;
			handler = registeredHandler;
		},
		sendMessage(message: unknown, options: unknown) {
			sent.push({ message, options });
		},
	} as unknown as ExtensionAPI;

	bangDontGhostExtension(pi);
	assert.ok(handler);
	const registeredHandler = handler;

	return {
		eventName,
		emit(event) {
			registeredHandler(event);
		},
		sent,
	};
}

test("creates an empty hidden follow-up delivered through the follow-up queue", () => {
	assert.deepEqual(createEmptyFollowUpRequest(), {
		message: {
			customType: "bang-dont-ghost",
			content: [],
			display: false,
		},
		options: {
			triggerTurn: true,
			deliverAs: "followUp",
		},
	});
});

test("registers only the user_bash_result event", () => {
	const extension = setupExtension();
	assert.equal(extension.eventName, "user_bash_result");
});

test("starts a follow-up for a completed single-bang command", () => {
	const extension = setupExtension();
	extension.emit(resultEvent());
	assert.deepEqual(extension.sent, [createEmptyFollowUpRequest()]);
});

test("starts a follow-up for a nonzero result", () => {
	const extension = setupExtension();
	extension.emit(resultEvent({ exitCode: 1 }));
	assert.deepEqual(extension.sent, [createEmptyFollowUpRequest()]);
});

test("does not follow up after a cancelled command", () => {
	const extension = setupExtension();
	extension.emit(resultEvent({ cancelled: true }));
	assert.deepEqual(extension.sent, []);
});

test("does not follow up after a double-bang command", () => {
	const extension = setupExtension();
	extension.emit(resultEvent({ excludeFromContext: true }));
	assert.deepEqual(extension.sent, []);
});

test("handles repeated commands independently without tracker state", () => {
	const extension = setupExtension();
	extension.emit(resultEvent({ command: "pwd" }));
	extension.emit(resultEvent({ command: "pwd" }));
	assert.deepEqual(extension.sent, [createEmptyFollowUpRequest(), createEmptyFollowUpRequest()]);
});
