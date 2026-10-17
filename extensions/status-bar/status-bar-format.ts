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
	/** Extension status ids, parallel to `statuses`; enables `regions` in the result. */
	statusIds?: readonly string[];
	separator: string;
};

export type StatusRegion = { id: string; start: number; end: number };
export type StatusLayoutResult = { line: string; regions: StatusRegion[] };

/**
 * Where each status landed: they follow `prefix` (when non-empty) one separator apart. Computed once
 * for the chosen layout and clipped to the visible line, so clicks never hit text cut by `…`.
 */
function statusRegions(data: StatusLayout, prefix: string, lineWidth: number): StatusRegion[] {
	const ids = data.statusIds;
	if (!ids?.length) return [];
	const separatorWidth = visibleWidth(data.separator);
	const regions: StatusRegion[] = [];
	let column = prefix ? visibleWidth(prefix) + separatorWidth : 0;
	for (let index = 0; index < data.statuses.length && column < lineWidth; index++) {
		const status = data.statuses[index]!;
		if (!status) continue;
		const end = Math.min(lineWidth, column + visibleWidth(status));
		const id = ids[index];
		if (id !== undefined) regions.push({ id, start: column, end });
		column = end + separatorWidth;
	}
	return regions;
}

/**
 * Prefer full fields; sacrifice path/provider detail before context or extension statuses.
 * Optional `extras` (a host editor's mode label, then its hints) follow the directory in priority
 * order, before extension statuses. When space runs out the last extra goes first, before any
 * field is shortened; the first extra outlives the directory on narrow terminals.
 */
export function layoutStatusBar(data: StatusLayout, width: number, extras: readonly string[] = []): string {
	return layoutStatusBarRegions(data, width, extras).line;
}

/** `layoutStatusBar` plus the columns of each extension status (when `statusIds` is given). */
export function layoutStatusBarRegions(
	data: StatusLayout,
	width: number,
	extras: readonly string[] = [],
): StatusLayoutResult {
	if (width <= 0) return { line: "", regions: [] };
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
			const prefix = withExtras(location!, count);
			const left = join([prefix, ...data.statuses]);
			const right = join([model!, data.context, data.cost]);
			const leftWidth = visibleWidth(left);
			const gap = width - leftWidth - visibleWidth(right);
			if (gap >= 3)
				return { line: left + " ".repeat(gap) + right, regions: statusRegions(data, prefix, leftWidth) };
		}
	}

	// On narrow terminals keep context first (including warning/error coloring),
	// then extension state. Optional metadata only consumes genuinely spare room.
	let line = join([data.context, ...data.statuses]);
	const lineWidth = visibleWidth(line);
	if (lineWidth > width) {
		// Keep one column free for the ellipsis so a clipped status is not clickable under it.
		return { line: truncateToWidth(line, width, "…"), regions: statusRegions(data, data.context, width - 1) };
	}
	const regions = statusRegions(data, data.context, lineWidth);
	for (const item of [kept[0] ?? "", data.shortModel, data.cost, data.shortLocation]) {
		if (!item) continue;
		const candidate = join([line, item]);
		if (visibleWidth(candidate) <= width) line = candidate;
	}
	return { line: truncateToWidth(line, width, "…"), regions };
}
