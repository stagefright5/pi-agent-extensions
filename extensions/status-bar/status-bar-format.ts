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
 * An optional `center` segment (such as editor hints) sits in the gap, centred, only when it fits
 * with room to spare at the full layout; it is the first thing dropped.
 */
export function layoutStatusBar(data: StatusLayout, width: number, center = ""): string {
	if (width <= 0) return "";
	const join = (parts: readonly string[]) => parts.filter(Boolean).join(data.separator);
	for (const [location, model] of [
		[data.location, data.model],
		[data.shortLocation, data.model],
		[data.shortLocation, data.shortModel],
	]) {
		const left = join([location!, ...data.statuses]);
		const right = join([model!, data.context, data.cost]);
		const gap = width - visibleWidth(left) - visibleWidth(right);
		const centerWidth = visibleWidth(center);
		if (centerWidth && gap >= centerWidth + 6) {
			const before = Math.floor((gap - centerWidth) / 2);
			return left + " ".repeat(before) + center + " ".repeat(gap - centerWidth - before) + right;
		}
		if (gap >= 3) return left + " ".repeat(gap) + right;
	}

	// On narrow terminals keep context first (including warning/error coloring),
	// then extension state. Optional metadata only consumes genuinely spare room.
	let line = join([data.context, ...data.statuses]);
	if (visibleWidth(line) > width) return truncateToWidth(line, width, "…");
	for (const item of [data.shortModel, data.cost, data.shortLocation]) {
		const candidate = join([line, item]);
		if (visibleWidth(candidate) <= width) line = candidate;
	}
	return truncateToWidth(line, width, "…");
}
