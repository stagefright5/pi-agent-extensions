import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export type ModelDisplay = {
	provider: string;
	name: string;
};

export function formatModelDisplayLabel(
	model: ModelDisplay | undefined,
	thinkingLevel: string | undefined,
): string | undefined {
	return model ? `${model.provider}/${model.name} (${thinkingLevel ?? "off"})` : undefined;
}

export function buildStatusBarParts(
	cwd: string,
	context: string,
	cost: string,
	model: string | undefined,
	statuses: readonly string[],
): string[] {
	return [cwd, context, cost, ...(model ? [model] : []), ...statuses];
}

export type StatusLayout = {
	location: string;
	shortLocation: string;
	model: string;
	shortModel: string;
	context: string;
	cost: string;
	statuses: readonly string[];
	separator: string;
};

/**
 * Prefer full fields; sacrifice path/provider detail before context or extension statuses.
 * Optional `extras` (a host editor's mode label, then its hints) follow the directory in priority
 * order, before extension statuses. When space runs out the last extra goes first, before any
 * field is shortened; the first extra outlives the directory on narrow terminals.
 */
export function layoutStatusBar(data: StatusLayout, width: number, extras: readonly string[] = []): string {
	if (width <= 0) return "";
	const join = (parts: readonly string[]) => parts.filter(Boolean).join(data.separator);
	const kept = extras.filter(Boolean);
	const withExtras = (location: string, count: number) =>
		[location, ...kept.slice(0, count)].filter(Boolean).join("  ");
	for (let count = kept.length; count >= 0; count--) {
		for (const [location, model] of [
			[data.location, data.model],
			[data.shortLocation, data.model],
			[data.shortLocation, data.shortModel],
		]) {
			const left = join([withExtras(location!, count), ...data.statuses]);
			const right = join([model!, data.context, data.cost]);
			const gap = width - visibleWidth(left) - visibleWidth(right);
			if (gap >= 3) return left + " ".repeat(gap) + right;
		}
	}

	// On narrow terminals keep context first (including warning/error coloring),
	// then extension state. Optional metadata only consumes genuinely spare room.
	let line = join([data.context, ...data.statuses]);
	if (visibleWidth(line) > width) return truncateToWidth(line, width, "…");
	for (const item of [kept[0] ?? "", data.shortModel, data.cost, data.shortLocation]) {
		if (!item) continue;
		const candidate = join([line, item]);
		if (visibleWidth(candidate) <= width) line = candidate;
	}
	return truncateToWidth(line, width, "…");
}
