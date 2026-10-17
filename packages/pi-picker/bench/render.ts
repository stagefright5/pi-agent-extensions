import { performance } from "node:perf_hooks";
import type { TUI } from "@earendil-works/pi-tui";
import type { SearchIndex } from "../src/core/index.ts";
import { createPicker } from "../src/ui/picker.ts";

const host = new URL(".", import.meta.resolve("@earendil-works/pi-coding-agent"));
const { KeybindingsManager } = await import(new URL("core/keybindings.js", host).href);
const { getThemeByName } = await import(new URL("modes/interactive/theme/theme.js", host).href);

/** One full picker frame (title, input, list with highlights, side preview, footer) at 160×48; `live` changes the preview every frame. */
export function renderBench(index: SearchIndex<string>, live = false): number[] {
	const theme = getThemeByName("dark");
	// Live mode: a 300-line log tail whose version changes every frame (worst case for previewKey).
	let version = 0;
	const tail = Array.from({ length: 300 }, (_, i) => `line ${i} build step compiling module ${i % 17}`).join("\n");
	const picker = createPicker<string>({
		tui: { terminal: { rows: 48, columns: 160 }, requestRender() {} } as unknown as TUI,
		theme: () => theme,
		keybindings: new KeybindingsManager(),
		title: "Prompt history",
		items: index.items,
		text: (item) => item,
		row: (item) => ({ primary: item, secondary: "Oct 12 · ~/Work/alpha" }),
		preview: live ? (item) => `${item}\n${tail}` : (item) => item,
		...(live ? { previewKey: () => String(version), previewTail: true } : {}),
		actions: [{ id: "insert", label: "insert", key: "tui.select.confirm", primary: true, run() {} }],
		onClose() {},
	});
	picker.focused = true;
	for (const char of "refactor") picker.handleInput(char);
	const samples: number[] = [];
	for (let frame = 0; frame < 220; frame++) {
		if (frame % 2 && !live) picker.handleInput("\x1b[B");
		version++;
		const started = performance.now();
		picker.render(160);
		if (frame >= 20) samples.push(performance.now() - started);
	}
	return samples;
}
