/** Custom keys are preserved at runtime although Pi's Settings type lists only core keys. */
export function getSetting(settings: object, key: string): unknown {
	return (settings as Record<string, unknown>)[key];
}
