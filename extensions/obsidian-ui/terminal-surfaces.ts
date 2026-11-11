import { readFileSync } from "node:fs";
import {
	Theme,
	type ExtensionAPI,
	type ExtensionUIContext,
	type ThemeBg,
	type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import type { TerminalColorMode, TerminalColors, TUI } from "@earendil-works/pi-tui";

export const TERMINAL_NATIVE = "terminal-native";
const WIDGET = "terminal-native-surfaces";
const template = JSON.parse(readFileSync(new URL("./themes/terminal-native.json", import.meta.url), "utf8")) as {
	colors: Record<string, string | number>;
};

type RGB = NonNullable<TerminalColors["background"]>;
const brightness = ({ r, g, b }: RGB) => (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
const hex = (rgb: RGB) => "#" + [rgb.r, rgb.g, rgb.b].map((channel) => channel.toString(16).padStart(2, "0")).join("");

/** Lift dark surfaces toward white, lower light surfaces toward black, preserving the terminal's tint. */
export function surfaceShade(background: RGB, amount: number, lighten: boolean): string {
	const target = lighten ? 255 : 0;
	const blend = (channel: number) => Math.round(channel + (target - channel) * amount);
	return hex({ r: blend(background.r), g: blend(background.g), b: blend(background.b) });
}

/** Only panel backgrounds are synthesized; ANSI status/syntax colors remain terminal-owned. */
export function terminalSurfaceTheme(reported: TerminalColors, mode: TerminalColorMode): Theme {
	const colors = { ...template.colors };
	let appearance: "dark" | "light" | undefined;
	if (reported.background) {
		const background = reported.background;
		const lighten = reported.foreground
			? brightness(reported.foreground) > brightness(background)
			: brightness(background) < 0.5;
		appearance = lighten ? "dark" : "light";
		const panel = surfaceShade(background, 0.07, lighten);
		const message = surfaceShade(background, 0.11, lighten);
		const selection = surfaceShade(background, 0.18, lighten);
		Object.assign(colors, {
			userMessageBg: message,
			customMessageBg: message,
			toolPendingBg: panel,
			toolSuccessBg: panel,
			toolErrorBg: panel,
			selectedBg: selection,
			searchMatchBg: selection,
			searchMatchText: "",
		});
	}
	const fg = {} as Record<ThemeColor, string | number>;
	const bg = {} as Record<ThemeBg, string | number>;
	for (const [token, value] of Object.entries(colors)) {
		if (token.endsWith("Bg")) bg[token as ThemeBg] = value;
		else fg[token as ThemeColor] = value;
	}
	return new Theme(fg, bg, mode, { name: TERMINAL_NATIVE, appearance });
}

type ThemeUI = Pick<ExtensionUIContext, "theme" | "setTheme">;
type ColorTUI = Pick<
	TUI,
	"queryTerminalColors" | "onTerminalColorSchemeChange" | "setTerminalColorSchemeNotifications"
>;

/** Public TUI color queries only: no terminal reads, polling, theme-file writes, or host patches. */
export function watchTerminalSurfaces(ui: ThemeUI, tui: ColorTUI) {
	let disposed = false;
	let generation = 0;
	let observed: Theme["colors"] | undefined;
	let installed: Theme | undefined;
	let lastReport: TerminalColors = {};
	let queued = false;

	const selected = () => !disposed && ui.theme.name === TERMINAL_NATIVE;
	const refresh = async () => {
		if (!selected()) return;
		const request = ++generation;
		observed = ui.theme.colors;
		// Setting an in-memory theme disables Pi's automatic appearance listener. We own one instead.
		tui.setTerminalColorSchemeNotifications(true);
		const apply = (report: TerminalColors) => {
			if (!selected() || request !== generation) return;
			lastReport = {
				background: report.background ?? lastReport.background,
				foreground: report.foreground ?? lastReport.foreground,
			};
			const next = terminalSurfaceTheme(lastReport, ui.theme.getColorMode());
			if (
				installed &&
				observed === installed.colors &&
				next.getBgAnsi("userMessageBg") === installed.getBgAnsi("userMessageBg") &&
				next.getBgAnsi("toolPendingBg") === installed.getBgAnsi("toolPendingBg")
			)
				return;
			installed = next;
			ui.setTheme(next);
			observed = ui.theme.colors;
			tui.setTerminalColorSchemeNotifications(true);
		};
		try {
			apply(await tui.queryTerminalColors({ timeoutMs: 100, onLateReply: apply }));
		} catch {
			// Keep a known background on transient failures; otherwise retain the flat fallback.
			apply({});
		}
	};
	const unsubscribe = tui.onTerminalColorSchemeChange(() => {
		void refresh();
	});
	return {
		render(): string[] {
			if (!selected()) {
				// Invalidate queries that started before selecting another theme, including late replies.
				generation++;
				observed = undefined;
			} else if (!queued && ui.theme.colors !== observed) {
				queued = true;
				// setTheme invalidates the whole TUI: never call it from inside a render pass.
				queueMicrotask(() => {
					queued = false;
					void refresh();
				});
			}
			return [];
		},
		invalidate() {},
		dispose() {
			if (disposed) return;
			disposed = true;
			generation++;
			unsubscribe();
			if (ui.theme.name === TERMINAL_NATIVE) tui.setTerminalColorSchemeNotifications(false);
			if (installed && ui.theme.colors === installed.colors) {
				ui.setTheme(terminalSurfaceTheme({}, ui.theme.getColorMode()));
			}
		},
	};
}

export function registerTerminalSurfaces(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		// A zero-row widget obtains the public TUI and observes theme selections without replacing chrome.
		ctx.ui.setWidget(WIDGET, (tui) => watchTerminalSurfaces(ctx.ui, tui), { placement: "belowEditor" });
	});
	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.mode === "tui") ctx.ui.setWidget(WIDGET, undefined);
	});
}
