/*
 * The default og:image. scripts/site-assets.mjs (the og entry of witch-banner in
 * SITE_ASSETS) writes it to public/ before each build, and Astro copies it to
 * dist/ unchanged. Keep the path and size in step with SITE_ASSETS;
 * tests/unit/site-assets.test.mjs fails when they drift apart.
 *
 * Kept free of imports: url-utils.ts re-exports it into the client bundle, and
 * the unit tests import it directly.
 */

export const DEFAULT_OG_IMAGE = Object.freeze({
	path: "/og/witch-banner.jpg",
	width: 1200,
	height: 630,
	type: "image/jpeg",
	alt: "necofuryai.dev のバナーイラスト (イラスト: こでびる)",
});

/*
 * Resolves the absolute URL for og:image, twitter:image, and JSON-LD. An
 * http(s) URL and a path under public/ (starting with "/") are used as given;
 * anything else (no image, an empty string, or a relative cover that
 * astro:assets resolves at build time and the head cannot reference) falls
 * back to the default image. Only the default image has a known size and alt
 * text, so the result says whether it was used. toUrl is url() from
 * url-utils.ts, which adds BASE_URL.
 */
export function resolveOgImage(image, site, toUrl) {
	if (!site) return undefined;
	if (image && /^https?:\/\//.test(image)) {
		return { url: image, isDefault: false };
	}
	if (image?.startsWith("/")) {
		return { url: new URL(toUrl(image), site).href, isDefault: false };
	}
	return {
		url: new URL(toUrl(DEFAULT_OG_IMAGE.path), site).href,
		isDefault: true,
	};
}
