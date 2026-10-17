import assert from "node:assert/strict";
import test from "node:test";
import { restorePlanState, STATE_TYPE } from "./state.ts";
const snapshot = (data: object) => ({ type: "custom", customType: STATE_TYPE, data });
const result = (iteration: number, plan: string, isError = false) => ({
	type: "message",
	message: {
		role: "toolResult",
		toolName: "plan_output",
		toolCallId: String(iteration),
		isError,
		details: { presented: true, iteration, planDir: "/old/plans/project", plan, title: "Title" },
	},
});
test("legacy snapshots, new results, branch cuts, and resets reconstruct without duplicates", () => {
	const legacy = snapshot({
		active: true,
		planDir: "/old/plans/project",
		iterations: ["old"],
		qaMessages: [{ role: "user", content: "old question" }],
	});
	const branch = [
		legacy,
		result(1, "old"),
		snapshot({ version: 2, active: true }),
		result(2, "failed", true),
		result(2, "new"),
		{ type: "message", message: { role: "user", content: "new question" } },
		snapshot({ version: 2, active: false }),
	];
	const state = restorePlanState(branch as never);
	assert.deepEqual(state.iterations, ["old", "new"]);
	assert.equal(state.planDir, "/old/plans/project");
	assert.deepEqual(
		state.qaMessages.map((m) => m.content),
		["old question", "new question"],
	);
	assert.equal(state.active, false);
	assert.deepEqual(restorePlanState(branch.slice(0, 2) as never).iterations, ["old"]);
	assert.deepEqual(
		restorePlanState([...branch, snapshot({ version: 2, reset: true, active: true, planDir: null })] as never)
			.iterations,
		[],
	);
});
test("legacy message_end snapshots preceding transcript messages do not duplicate Q&A", () => {
	const question = { role: "user", content: "question" };
	const legacy = snapshot({ active: true, qaMessages: [question], iterations: [] });
	const branch = [legacy, { type: "message", message: question }];
	assert.deepEqual(restorePlanState(branch as never).qaMessages, [question]);
	assert.deepEqual(
		restorePlanState([
			...branch,
			snapshot({ version: 2, active: true }),
			{ type: "message", message: question },
		] as never).qaMessages,
		[question, question],
	);
});

test("attempted plans are not restored without a successful result; legacy results recover call arguments", () => {
	const branch = [
		snapshot({ version: 2, active: true, reset: true }),
		{
			type: "message",
			message: {
				role: "assistant",
				content: [
					{ type: "toolCall", id: "x", name: "plan_output", arguments: { title: "Legacy", plan: "text" } },
				],
			},
		},
	];
	assert.deepEqual(restorePlanState(branch as never).iterations, []);
	const restored = restorePlanState([
		...branch,
		{
			type: "message",
			message: {
				role: "toolResult",
				toolName: "plan_output",
				toolCallId: "x",
				isError: false,
				details: { presented: true, iteration: 1, planDir: "/legacy" },
			},
		},
	] as never);
	assert.deepEqual(restored.iterations, ["text"]);
	assert.equal(restored.planTitle, "Legacy");
});
