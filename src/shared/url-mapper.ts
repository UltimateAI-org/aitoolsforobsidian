/**
 * URL Mapper - Transparent domain aliasing
 *
 * Allows users to see/configure branded domains (obsidianaitools.com)
 * while transparently using the actual API endpoint (ultimateai.org)
 * for authentication and API calls.
 */

/**
 * Map of display domains to actual API domains
 */
const DOMAIN_ALIASES: Record<string, string> = {
	"chat.obsidianaitools.com": "chat.ultimateai.org",
	"chat.obisidianaitools.com": "chat.ultimateai.org", // Handle typo variant
	"obsidianaitools.com": "ultimateai.org",
};

/**
 * Convert a display URL to the actual API URL
 * @param url - User-facing URL (e.g., https://chat.obsidianaitools.com)
 * @returns Actual API URL (e.g., https://chat.ultimateai.org)
 */
export function mapToApiUrl(url: string): string {
	if (!url) return url;

	try {
		const urlObj = new URL(url);
		const mappedDomain = DOMAIN_ALIASES[urlObj.hostname];

		if (mappedDomain) {
			urlObj.hostname = mappedDomain;
			return urlObj.toString();
		}

		return url;
	} catch {
		// If URL parsing fails, return original
		return url;
	}
}

/**
 * Convert an actual API URL back to the display URL
 * @param url - API URL (e.g., https://chat.ultimateai.org)
 * @returns Display URL (e.g., https://chat.obsidianaitools.com)
 */
export function mapToDisplayUrl(url: string): string {
	if (!url) return url;

	try {
		const urlObj = new URL(url);

		// Reverse lookup in aliases
		for (const [displayDomain, apiDomain] of Object.entries(DOMAIN_ALIASES)) {
			if (urlObj.hostname === apiDomain) {
				urlObj.hostname = displayDomain;
				return urlObj.toString();
			}
		}

		return url;
	} catch {
		return url;
	}
}
