import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { homedir } from "node:os";

/** One display line: no escapes, newlines or tabs. */
export const singleLine = (text: string): string => stripTerminalSequences(text).replace(/[\r\n\t]/g, " ");

/** `/Users/me/x` → `~/x`. */
export function tildePath(text: string): string {
	const home = homedir();
	return home && text.startsWith(home + "/") ? "~" + text.slice(home.length) : text;
}

/** Left text and right text on one row of exactly `width` columns; the right side wins when space runs out. */
export function spread(left: string, right: string, width: number): string {
	if (width <= 0) return "";
	const rightWidth = visibleWidth(right);
	if (!rightWidth) return truncateToWidth(left, width, "…") + " ".repeat(Math.max(0, width - visibleWidth(left)));
	const room = width - rightWidth;
	if (room < 2) return truncateToWidth(right, width, "");
	const head = truncateToWidth(left, room - 1, "…");
	return head + " ".repeat(Math.max(1, room - visibleWidth(head))) + right;
}

/** Resolve a static value or a getter. */
export type Dynamic<T> = T | (() => T);
export const resolve = <T>(value: Dynamic<T>): T => (typeof value === "function" ? (value as () => T)() : value);
