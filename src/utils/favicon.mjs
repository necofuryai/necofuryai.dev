/*
 * The favicons, resized from the avatar. scripts/site-assets.mjs (the favicons
 * entry of witch-avatar in SITE_ASSETS) writes them to public/ before each
 * build, and Astro copies them to dist/ unchanged. Keep the paths and sizes in
 * step with SITE_ASSETS; tests/unit/site-assets.test.mjs fails when they drift
 * apart.
 *
 * Kept free of imports: config.ts reaches the client bundle, and the unit tests
 * import it directly.
 */

export const AVATAR_FAVICONS = Object.freeze([
	Object.freeze({ src: "/favicon/witch-avatar-32.png", sizes: "32x32" }),
	Object.freeze({ src: "/favicon/witch-avatar-128.png", sizes: "128x128" }),
	Object.freeze({ src: "/favicon/witch-avatar-180.png", sizes: "180x180" }),
	Object.freeze({ src: "/favicon/witch-avatar-192.png", sizes: "192x192" }),
]);
