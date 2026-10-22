import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_OG_IMAGE, resolveOgImage } from "../../src/utils/og-image.mjs";

const site = new URL("https://necofuryai.dev/");
const asIs = (path) => path;
const DEFAULT_URL = "https://necofuryai.dev/og/witch-banner.jpg";

test("pages without a usable cover share the default image", () => {
	// 相対パスのカバーは astro:assets がビルド時に解決するので、head からは参照できない
	for (const image of [undefined, "", "cover.png", "./cover.png"]) {
		assert.deepEqual(resolveOgImage(image, site, asIs), {
			url: DEFAULT_URL,
			isDefault: true,
		});
	}
});

test("an absolute URL or a public path is used as given", () => {
	assert.deepEqual(resolveOgImage("https://example.com/a.png", site, asIs), {
		url: "https://example.com/a.png",
		isDefault: false,
	});
	assert.deepEqual(resolveOgImage("/images/a.png", site, asIs), {
		url: "https://necofuryai.dev/images/a.png",
		isDefault: false,
	});
});

test("resolveOgImage needs the site and applies the base path", () => {
	assert.equal(resolveOgImage(undefined, undefined, asIs), undefined);
	assert.equal(
		resolveOgImage(undefined, site, (path) => `/blog${path}`).url,
		"https://necofuryai.dev/blog/og/witch-banner.jpg",
	);
});

test("DEFAULT_OG_IMAGE describes a frozen 1200x630 JPEG with alt text", () => {
	assert.ok(Object.isFrozen(DEFAULT_OG_IMAGE));
	assert.deepEqual(
		[DEFAULT_OG_IMAGE.width, DEFAULT_OG_IMAGE.height, DEFAULT_OG_IMAGE.type],
		[1200, 630, "image/jpeg"],
	);
	assert.match(DEFAULT_OG_IMAGE.alt, /こでびる/);
});
