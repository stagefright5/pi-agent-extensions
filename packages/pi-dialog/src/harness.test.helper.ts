/** Shared test fixtures: real Pi themes, a keybinding stub, mouse events, and a fake `ctx.ui.custom`. */
import { initTheme, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, type Component, type KeyId, type TuiMouseEvent } from "@earendil-works/pi-tui";
import type { DialogContext } from "./dialogs.ts";

const host = new URL(".", import.meta.resolve("@earendil-works/pi-coding-agent"));
const themes = await import(new URL("modes/interactive/theme/theme.js", host).href);
initTheme("dark", false);
export const dark: Theme = themes.getThemeByName("dark");
export const light: Theme = themes.getThemeByName("light");
export const setThemeInstance: (theme: Theme) => void = themes.setThemeInstance;

const KEYS: Record<string, KeyId> = {
	"tui.select.cancel": "escape",
	"tui.select.confirm": "enter",
	"tui.select.up": "up",
	"tui.select.down": "down",
	"tui.select.pageUp": "pageUp",
	"tui.select.pageDown": "pageDown",
};
export const keybindings = {
	matches(data: string, id: string) {
		const key = KEYS[id];
		return key !== undefined && matchesKey(data, key);
	},
	getKeys(id: string) {
		const key = KEYS[id];
		return key ? [key] : [];
	},
} as unknown as KeybindingsManager;

export const mouse = (type: TuiMouseEvent["type"], x: number, y: number, extra = {}): TuiMouseEvent => ({
	type,
	x,
	y,
	screenX: x,
	screenY: y,
	width: 80,
	height: 36,
	button: "left",
	shift: false,
	alt: false,
	ctrl: false,
	...extra,
});

export type Mounted = Component & { dispose?(): void; focused?: boolean };

/** A fake extension context whose `custom` mounts the component synchronously, like Pi does. */
export function fakeContext(options: { mode?: string; rows?: number } = {}) {
	const state = {
		component: undefined as Mounted | undefined,
		overlay: undefined as unknown,
		renders: 0,
		disposals: 0,
		notes: [] as Array<[string, string | undefined]>,
		calls: [] as Array<[string, unknown[]]>,
		replies: {} as Record<string, unknown>,
	};
	const tui = {
		terminal: { rows: options.rows ?? 30, columns: 100 },
		requestRender() {
			state.renders++;
		},
	};
	const builtin =
		(name: string) =>
		async (...args: unknown[]) => {
			state.calls.push([name, args]);
			const reply = state.replies[name];
			return Array.isArray(reply) ? reply.shift() : reply;
		};
	const ctx = {
		mode: options.mode ?? "tui",
		ui: {
			theme: dark,
			custom: (factory: any, overlay: unknown) =>
				new Promise((resolve) => {
					state.overlay = overlay;
					let component: Mounted | undefined;
					component = factory(tui, dark, keybindings, (value: unknown) => {
						state.disposals++;
						component?.dispose?.();
						resolve(value);
					});
					state.component = component;
					if (component) component.focused = true;
				}),
			notify: (message: string, type?: string) => {
				state.notes.push([message, type]);
			},
			confirm: builtin("confirm"),
			select: builtin("select"),
			input: builtin("input"),
			editor: builtin("editor"),
		},
	} as unknown as DialogContext;
	const mounted = () => {
		if (!state.component) throw new Error("nothing mounted");
		return state.component;
	};
	return {
		ctx,
		state,
		tui,
		mounted,
		press: (...keys: string[]) => {
			for (const key of keys) mounted().handleInput?.(key);
		},
		render: (width = 80) => mounted().render(width),
	};
}

export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
