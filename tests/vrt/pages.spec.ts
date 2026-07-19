import { expect, test } from "@playwright/test";

const cases = [
	{ path: "/", name: "home", ready: 'a[href="/posts/hello-world/"]' },
	{ path: "/about/", name: "about", ready: "main h1" },
	{ path: "/privacy/", name: "privacy", ready: "main h1" },
	{ path: "/playlists/", name: "playlists", ready: "main h1" },
	{
		path: "/archive/",
		name: "archive",
		ready: 'a[aria-label="Hello World"]',
	},
	{
		path: "/posts/hello-world/",
		name: "hello-world",
		ready: "#post-container",
	},
] as const;

test.beforeEach(async ({ page }) => {
	await page.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
		const remoteHttp =
			(url.protocol === "http:" || url.protocol === "https:") && !local;
		await (remoteHttp ? route.abort() : route.continue());
	});
});

for (const item of cases) {
	test(`visual: ${item.path}`, async ({ page }) => {
		await page.goto(item.path, { waitUntil: "load" });
		await page.locator(item.ready).first().waitFor({ state: "visible" });
		await page.evaluate(() => document.fonts.ready);
		await page.evaluate(
			() =>
				new Promise<void>((resolve) => {
					requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
				}),
		);
		await expect(page).toHaveScreenshot(`${item.name}.png`, {
			fullPage: true,
		});
	});
}
