import { truncateToWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

export function browserFrame(width: number, theme: Theme, error = false) {
	const columns = Math.max(0, Math.floor(width));
	return {
		rule: () => theme.fg(error ? "error" : "borderMuted", "─".repeat(columns)),
		row: (content: string, selected = false) => {
			const fitted = truncateToWidth(content, columns, "…", true);
			return selected ? theme.bg("selectedBg", fitted) : fitted;
		},
	};
}
