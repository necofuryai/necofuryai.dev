import { expect, type Page, test } from "@playwright/test";

const cases = [
	{ path: "/", ready: 'a[href="/posts/hello-world/"]' },
	{ path: "/about/", ready: "main h1" },
	{ path: "/privacy/", ready: "main h1" },
	{ path: "/playlists/", ready: "main h1" },
	{ path: "/archive/", ready: 'a[aria-label="Hello World"]' },
	{ path: "/posts/hello-world/", ready: "#post-container" },
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
	test(`route renders: ${item.path}`, async ({ page }) => {
		const response = await page.goto(item.path, { waitUntil: "load" });
		expect(response?.ok()).toBe(true);

		const ready = page.locator(item.ready);
		expect(await ready.count()).toBeGreaterThan(0);
		await expect(ready.first()).toBeVisible();
	});
}

test("theme switch enables dark mode and persists it", async ({ page }) => {
	await page.addInitScript(() => {
		if (localStorage.getItem("theme") === null) {
			localStorage.setItem("theme", "light");
		}
	});
	await page.goto("/", { waitUntil: "load" });
	const switchButton = page.getByRole("menuitem", {
		name: "Light/Dark Mode",
	});
	await expect(switchButton).toHaveCount(1);
	await expect(switchButton).toBeVisible();

	await switchButton.click();
	expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("dark");
	await expect(page.locator("html")).toHaveClass(/dark/);

	await page.reload({ waitUntil: "load" });
	expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("dark");
	await expect(page.locator("html")).toHaveClass(/dark/);
});

test("about page exposes the profile and experience timeline", async ({
	page,
}) => {
	await page.goto("/about/", { waitUntil: "load" });
	await expect(
		page.locator("main p").filter({ hasText: "a software engineer with" }),
	).toHaveCount(1);
	await expect(
		page.getByRole("heading", { level: 2, name: "Experience" }),
	).toBeVisible();
	const experienceItems = page.locator(
		'section[aria-labelledby="experience-heading"] > ol > li',
	);
	expect(await experienceItems.count()).toBeGreaterThan(0);
});

async function firstTrackList(page: Page) {
	const trackList = page.locator("main details").first();
	await expect(trackList).toBeVisible();
	return trackList;
}

async function verifyTrackListCollapse(page: Page) {
	const trackList = await firstTrackList(page);
	const summary = trackList.locator(":scope > summary");
	await expect(summary).toHaveCount(1);
	await summary.click();
	await expect(trackList).toHaveAttribute("open", "");

	const collapseButton = trackList.getByRole("button", {
		name: "曲一覧を折りたたむ",
	});
	await expect(collapseButton).toHaveCount(1);
	await expect(collapseButton).toBeVisible();
	await collapseButton.click();

	await expect(trackList).not.toHaveAttribute("open", "");
	await expect(summary).toBeFocused();
}

test("playlist track lists expand and collapse without an iframe", async ({
	page,
}) => {
	await page.goto("/playlists/", { waitUntil: "load" });
	await expect(page.locator("iframe")).toHaveCount(0);
	await verifyTrackListCollapse(page);
});

test("playlist controls survive a Swup revisit", async ({ page }) => {
	await page.goto("/playlists/", { waitUntil: "load" });
	await page.evaluate(() => {
		(
			window as Window & { __uiSmokeSwupSentinel?: boolean }
		).__uiSmokeSwupSentinel = true;
	});

	const aboutLink = page.locator('#navbar a[aria-label="About"]');
	await expect(aboutLink).toHaveCount(1);
	await Promise.all([page.waitForURL("**/about/"), aboutLink.click()]);
	await expect(
		page.getByRole("heading", { level: 1, name: "About" }),
	).toBeVisible();

	const playlistsLink = page.locator('#navbar a[aria-label="Playlists"]');
	await expect(playlistsLink).toHaveCount(1);
	await Promise.all([page.waitForURL("**/playlists/"), playlistsLink.click()]);

	expect(
		await page.evaluate(
			() =>
				(window as Window & { __uiSmokeSwupSentinel?: boolean })
					.__uiSmokeSwupSentinel,
		),
	).toBe(true);
	await verifyTrackListCollapse(page);
});
