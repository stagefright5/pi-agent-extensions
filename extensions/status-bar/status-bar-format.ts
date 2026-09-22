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
