export declare const DEFAULT_OG_IMAGE: Readonly<{
	path: string;
	width: number;
	height: number;
	type: string;
	alt: string;
}>;

/**
 * @param image frontmatter image (an http(s) URL, a path under public/, a relative cover, or empty)
 * @param site Astro.site
 * @param toUrl url() from url-utils.ts (adds BASE_URL)
 */
export function resolveOgImage(
	image: string | undefined,
	site: URL | undefined,
	toUrl: (path: string) => string,
): { url: string; isDefault: boolean } | undefined;
