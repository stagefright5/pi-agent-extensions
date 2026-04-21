/**
 * Utility functions for plan mode.
 */

/**
 * Generate a URL-friendly slug from a title string.
 */
export function generateSlug(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 50);
}
