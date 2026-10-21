import assert from "node:assert/strict";
import test from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { alert, confirm, editor, input, select, withLoader } from "./dialogs.ts";
import { showDocument } from "./document.ts";
import { openPopup } from "./open.ts";
import { fakeContext, flush, mouse } from "./harness.test.helper.ts";
import type { Popup } from "./popup.ts";

const text = (lines: string[]) => lines.map(stripTerminalSequences).join("\n");
const ENTER = "\r";
const ESC = "\x1b";

test("openPopup: close is idempotent, abort and timeout resolve undefined once and clean up", async (t) => {
	const f = fakeContext();
	let closeFn!: (value?: string) => void;
	let lifetime!: AbortSignal;
	const opened = openPopup<string>(
		f.ctx,
		(api) => {
			closeFn = api.close;
			lifetime = api.signal;
			return { render: () => ["body"], invalidate() {} };
		},
		{ title: "t" },
	);
	closeFn("first");
	closeFn("second");
	assert.equal(await opened, "first");
	assert.equal(lifetime.aborted, true);
	assert.equal(f.state.disposals, 1);

	const controller = new AbortController();
	const aborted = openPopup(f.ctx, () => ({ render: () => [], invalidate() {} }), { signal: controller.signal });
	controller.abort();
	assert.equal(await aborted, undefined);
	assert.equal(
		await openPopup(f.ctx, () => ({ render: () => [], invalidate() {} }), { signal: controller.signal }),
		undefined,
	);

	t.mock.timers.enable({ apis: ["setInterval", "Date"] });
	const timed = openPopup(f.ctx, () => ({ render: () => ["x"], invalidate() {} }), { title: "t", timeout: 2000 });
	assert.match(text(f.render(40)), /2s ─╮/u);
	t.mock.timers.tick(1000);
	assert.match(text(f.render(40)), /1s ─╮/u);
	t.mock.timers.tick(1000);
	assert.equal(await timed, undefined);
	t.mock.timers.reset();
});

test("openPopup: the host disposing the popup removes abort listeners without resolving twice", async () => {
	const f = fakeContext();
	const controller = new AbortController();
	let lifetime!: AbortSignal;
	void openPopup(
		f.ctx,
		(api) => {
			lifetime = api.signal;
			return { render: () => [], invalidate() {} };
		},
		{ signal: controller.signal },
	);
	(f.mounted() as Popup).dispose();
	assert.equal(lifetime.aborted, true);
	controller.abort();
	assert.equal(f.state.disposals, 0);
});

test("confirm: y/n keys, focus ring with Enter, Esc cancels, danger focuses the safe button", async () => {
	for (const [keys, expected] of [
		[["y"], true],
		[["n"], false],
		[[ENTER], true],
		[["\t", ENTER], false],
		[[ESC], false],
		[["\x03"], false],
	] as const) {
		const f = fakeContext();
		const result = confirm(f.ctx, { title: "Proceed?", message: "Do it" });
		f.render(60);
		f.press(...keys);
		assert.equal(await result, expected, keys.join("+"));
	}
	const f = fakeContext();
	const result = confirm(f.ctx, { title: "Delete", message: "Gone forever", tone: "danger", confirmLabel: "Delete" });
	const shown = text(f.render(60));
	assert.match(shown, /✗ Delete/u);
	assert.match(shown, /Gone forever/u);
	f.press(ENTER);
	assert.equal(await result, false, "Enter on a danger dialog picks the safe button");
});

test("confirm, select, input and editor fall back to Pi's built-in dialogs outside TUI mode", async () => {
	const f = fakeContext({ mode: "rpc" });
	f.state.replies = { confirm: true, select: "Beta", input: ["bad", "good"], editor: "text" };
	assert.equal(await confirm(f.ctx, { title: "t", message: "m" }), true);
	assert.equal(
		await select(f.ctx, {
			title: "pick",
			options: [
				{ value: 1, label: "Alpha" },
				{ value: 2, label: "Beta" },
				{ value: 3, label: "Gone", disabled: true },
			],
		}),
		2,
	);
	assert.deepEqual(f.state.calls[1]![1].slice(0, 2), ["pick", ["Alpha", "Beta"]]);
	assert.equal(await input(f.ctx, { title: "name", validate: (v) => (v === "bad" ? "no" : undefined) }), "good");
	assert.deepEqual(f.state.notes, [["no", "warning"]]);
	assert.equal(await editor(f.ctx, { title: "edit", prefill: "x" }), "text");
	assert.equal(await showDocument(f.ctx, { title: "doc", content: "x" }), "cancel");
	assert.equal(await withLoader(f.ctx, "Work", new AbortController().signal, async () => 7), 7);
	await alert(f.ctx, { title: "Heads up", message: "done", tone: "warning" });
	assert.deepEqual(f.state.notes.at(-1), ["Heads up: done", "warning"]);
	assert.equal(f.state.component, undefined);
});

test("alert closes on Enter or Esc", async () => {
	for (const key of [ENTER, ESC]) {
		const f = fakeContext();
		const done = alert(f.ctx, { title: "Saved", message: "All good" });
		assert.match(text(f.render(60)), /All good/u);
		f.press(key);
		assert.equal(await done, undefined);
	}
});

test("select: arrows skip disabled items, digits choose, Enter confirms, Esc cancels, clicks choose", async () => {
	const options = [
		{ value: "a", label: "Alpha", description: "first" },
		{ value: "b", label: "Beta", disabled: true },
		{ value: "c", label: "Gamma" },
	];
	let f = fakeContext();
	let result = select(f.ctx, { title: "Pick", message: "Choose a letter", options });
	const shown = text(f.render(60));
	assert.match(shown, /› 1 {2}Alpha +first/u);
	f.press("\x1b[B", ENTER);
	assert.equal(await result, "c");

	f = fakeContext();
	result = select(f.ctx, { title: "Pick", options, initial: "c" });
	f.render(60);
	f.press("2", "1");
	assert.equal(await result, "a");

	f = fakeContext();
	result = select(f.ctx, { title: "Pick", options });
	f.render(60);
	f.press(ESC);
	assert.equal(await result, undefined);

	f = fakeContext();
	result = select(f.ctx, { title: "Pick", options });
	const lines = f.render(60).map(stripTerminalSequences);
	const row = lines.findIndex((line) => line.includes("Gamma"));
	f.mounted().handleMouse?.(mouse("click", lines[row]!.indexOf("Gamma"), row));
	assert.equal(await result, "c");
});

test("select scrolls long lists within the popup height", async () => {
	const f = fakeContext({ rows: 14 });
	const options = Array.from({ length: 40 }, (_, i) => ({ value: i, label: `Item ${i}` }));
	const result = select(f.ctx, { title: "Many", options });
	const first = f.render(50);
	assert.ok(first.length <= Math.floor(14 * 0.7));
	f.press(...Array.from({ length: 25 }, () => "\x1b[B"));
	const later = text(f.render(50));
	assert.match(later, /Item 25/u);
	assert.match(later, /26\/40/u);
	f.press(ENTER);
	assert.equal(await result, 25);
});

test("input: typing reaches the field, validation keeps it open, Enter submits, Esc cancels", async () => {
	let f = fakeContext();
	let result = input(f.ctx, {
		title: "Branch",
		message: "Name it",
		placeholder: "feature/…",
		validate: (value) => (value.includes(" ") ? "No spaces" : undefined),
	});
	assert.match(text(f.render(60)), /feature\/…/u);
	f.press("a", " ", "b", ENTER);
	assert.match(text(f.render(60)), /No spaces/u);
	f.press("\x7f", "\x7f", "c", ENTER);
	assert.equal(await result, "ac");

	f = fakeContext();
	result = input(f.ctx, { title: "Branch", initial: "main" });
	f.render(60);
	f.press(ESC);
	assert.equal(await result, undefined);
});

test("editor hosts Pi's extension editor without its own rules; Enter submits and Esc cancels", async () => {
	let f = fakeContext();
	let result = editor(f.ctx, { title: "Revise plan", message: "What should change?", prefill: "draft" });
	const lines = f.render(70);
	const shown = text(lines);
	assert.match(shown, /✎ Revise plan/u);
	assert.match(shown, /What should change\?/u);
	assert.match(shown, /draft/u);
	for (const line of lines) assert.ok(visibleWidth(line) <= 70);
	f.press("!", ENTER);
	assert.equal(await result, "draft!");

	f = fakeContext();
	result = editor(f.ctx, { title: "Revise plan" });
	f.render(70);
	f.press(ESC);
	assert.equal(await result, undefined);
});

test("withLoader: resolves with work, Esc aborts work, errors are reported once", async () => {
	let f = fakeContext();
	const outer = new AbortController();
	assert.equal(await withLoader(f.ctx, "Generating", outer.signal, async () => "done"), "done");

	f = fakeContext();
	let workSignal!: AbortSignal;
	const pending = withLoader(f.ctx, "Generating", outer.signal, (signal) => {
		workSignal = signal;
		return new Promise<string>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
	});
	await flush();
	assert.match(text(f.render(60)), /Generating/u);
	f.press(ESC);
	assert.equal(await pending, undefined);
	assert.equal(workSignal.aborted, true);
	assert.deepEqual(f.state.notes, []);

	f = fakeContext();
	const errors: unknown[] = [];
	assert.equal(
		await withLoader(
			f.ctx,
			"Generating",
			outer.signal,
			async () => {
				throw new Error("boom");
			},
			{ onError: (error) => errors.push(error) },
		),
		undefined,
	);
	assert.equal(errors.length, 1);

	f = fakeContext();
	const aborting = new AbortController();
	const cancelled = withLoader(f.ctx, "Generating", aborting.signal, () => new Promise(() => {}));
	aborting.abort();
	assert.equal(await cancelled, undefined);
});

test("showDocument resolves the chosen action and passes the overlay a wide centred placement", async () => {
	const f = fakeContext();
	const result = showDocument(f.ctx, {
		kind: "Plan review",
		title: "T",
		content: "# Hi",
		actions: [{ key: "a", label: "approve", value: "approve", primary: true }],
	});
	assert.match(text(f.render(80)), /Plan review {2}T/u);
	f.press("a");
	assert.equal(await result, "approve");
	assert.deepEqual((f.state.overlay as { overlayOptions: unknown }).overlayOptions, {
		anchor: "center",
		width: "90%",
		minWidth: 30,
	});
});
