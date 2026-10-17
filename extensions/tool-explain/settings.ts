import { readJsonFile, writeJsonFile, getSetting } from "@stagefright5/pi-extension-utils";
import { join } from "node:path";
import { getAgentDir, getSettingsListTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, SettingsList, Text } from "@earendil-works/pi-tui";
import { parseModelRef, type ModelRef } from "./explain.ts";

export type Selection = { tools: "all" | string[]; excludeTools: string[] };
export type ExplainSettings = Selection & { model?: ModelRef };

function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function loadSettings(dir = getAgentDir(), effective: object = {}): ExplainSettings {
	const saved = readJsonFile(join(dir, "tool-explain.json"));
	if (saved !== undefined && !object(saved)) throw new Error("tool-explain.json must contain an object");
	const legacy = getSetting(effective, "toolExplain") ?? getSetting(effective, "codemodeExplain");
	if (legacy !== undefined && !object(legacy)) throw new Error("toolExplain must be an object");
	const value = { ...legacy, ...saved };
	const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");
	if (value.tools !== undefined && value.tools !== "all" && !strings(value.tools))
		throw new Error('toolExplain.tools must be "all" or a list of tool names');
	if (value.excludeTools !== undefined && !strings(value.excludeTools))
		throw new Error("toolExplain.excludeTools must be a list of tool names");
	return {
		model: parseModelRef(value.model),
		tools: (value.tools as Selection["tools"] | undefined) ?? "all",
		excludeTools: (value.excludeTools as string[] | undefined) ?? [],
	};
}

export function enabled(selection: Selection, name: string): boolean {
	return (selection.tools === "all" || selection.tools.includes(name)) && !selection.excludeTools.includes(name);
}

/** A complete selection in an extension-owned file; never rewrite Pi's shared settings. */
export function saveSelection(selection: Selection, dir = getAgentDir()): void {
	loadSettings(dir); // Fail closed on malformed saved configuration.
	const saved = readJsonFile(join(dir, "tool-explain.json"));
	writeJsonFile(join(dir, "tool-explain.json"), { ...(object(saved) ? saved : {}), ...selection });
}

export function registerPicker(pi: ExtensionAPI): void {
	pi.registerCommand("tool-explain", {
		description: "Choose tools with AI explanations (saved in tool-explain.json)",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/tool-explain requires TUI mode", "warning");
				return;
			}
			await ctx.waitForIdle();
			let selection: Selection;
			try {
				selection = loadSettings(getAgentDir(), pi.getSettings());
			} catch (error) {
				ctx.ui.notify(`tool-explain: ${String(error)}`, "error");
				return;
			}
			const names = [
				...new Set([
					...pi.getAllTools().map((tool) => tool.name),
					...(selection.tools === "all" ? [] : selection.tools),
					...selection.excludeTools,
				]),
			].sort();
			let changed = false;
			await ctx.ui.custom<void>((tui, theme, _kb, done) => {
				const container = new Container();
				container.addChild(new Text(theme.fg("accent", theme.bold("Tool explanations")), 0, 0));
				container.addChild(
					new Text(
						"Changes save immediately. Esc closes and reloads extensions.\nAll mode includes future tools; selected mode only includes enabled names.",
						0,
						0,
					),
				);
				const list = new SettingsList(
					[
						{
							id: "mode",
							label: "Tool selection",
							currentValue: selection.tools === "all" ? "all" : "selected",
							values: ["all", "selected"],
						},
						...names.map((name) => ({
							id: `tool:${name}`,
							label: name,
							currentValue: enabled(selection, name) ? "enabled" : "disabled",
							values: ["enabled", "disabled"],
						})),
					],
					15,
					getSettingsListTheme(),
					(id, value) => {
						const next: Selection = {
							tools: selection.tools === "all" ? "all" : [...selection.tools],
							excludeTools: [...selection.excludeTools],
						};
						if (id === "mode") {
							next.tools = value === "all" ? "all" : names.filter((name) => enabled(selection, name));
							next.excludeTools = [];
						} else {
							const name = id.slice(5);
							next.excludeTools = next.excludeTools.filter((tool) => tool !== name);
							if (next.tools === "all") {
								if (value === "disabled") next.excludeTools.push(name);
							} else {
								next.tools = next.tools.filter((tool) => tool !== name);
								if (value === "enabled") next.tools.push(name);
							}
						}
						try {
							saveSelection(next);
							selection = next;
							changed = true;
						} catch (error) {
							ctx.ui.notify(`tool-explain: could not save: ${String(error)}`, "error");
						}
						list.updateValue("mode", selection.tools === "all" ? "all" : "selected");
						for (const name of names)
							list.updateValue(`tool:${name}`, enabled(selection, name) ? "enabled" : "disabled");
					},
					() => done(),
					{ enableSearch: true },
				);
				container.addChild(list);
				return {
					render: (width) => container.render(width),
					invalidate: () => container.invalidate(),
					handleInput: (data) => {
						list.handleInput(data);
						tui.requestRender();
					},
				};
			});
			// Reload applies the new renderer choices to existing rows.
			if (changed) await ctx.reload();
		},
	});
}
