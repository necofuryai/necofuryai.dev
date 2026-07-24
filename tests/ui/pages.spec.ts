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

test("search fields expose stable form metadata and accessible names", async ({
	page,
}) => {
	await page.goto("/", { waitUntil: "load" });

	const desktopSearch = page.locator("#search-bar input");
	const mobileSearch = page.locator("#search-bar-inside input");
	await expect(desktopSearch).toHaveAttribute("id", "site-search-desktop");
	await expect(mobileSearch).toHaveAttribute("id", "site-search-mobile");
	await expect(desktopSearch).toHaveAttribute("type", "search");
	await expect(mobileSearch).toHaveAttribute("type", "search");
	await expect(desktopSearch).toHaveAccessibleName("検索");
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(mobileSearch).toBeVisible();
	await expect(mobileSearch).toHaveAccessibleName("検索");
});

test("desktop search clears results when its query is emptied", async ({
	page,
}) => {
	await page.goto("/", { waitUntil: "load" });

	const searchInput = page.locator("#search-bar input");
	const searchPanel = page.locator("#search-panel");
	const helloWorldResult = searchPanel.locator('a[href="/posts/hello-world/"]');
	await expect(searchInput).toBeVisible();

	await searchInput.fill("Hello");
	await expect(helloWorldResult).toBeVisible();

	await searchInput.fill("");
	await expect(helloWorldResult).toHaveCount(0);
	await expect(searchPanel).toHaveClass(/float-panel-closed/);
});

test("mobile search clears results without closing its input panel", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/", { waitUntil: "load" });

	const searchSwitch = page.locator("#search-switch");
	const searchInput = page.locator("#site-search-mobile");
	const searchPanel = page.locator("#search-panel");
	const helloWorldResult = searchPanel.locator('a[href="/posts/hello-world/"]');
	await expect(searchSwitch).toBeVisible();
	await searchSwitch.click();
	await expect(searchInput).toBeVisible();

	await searchInput.fill("Hello");
	await expect(helloWorldResult).toBeVisible();

	await searchInput.fill("");
	await expect(helloWorldResult).toHaveCount(0);
	await expect(searchPanel).not.toHaveClass(/float-panel-closed/);
	await expect(searchInput).toBeVisible();
});

test("desktop search ignores a stale result after its query is cleared", async ({
	page,
}) => {
	await page.goto("/", { waitUntil: "load" });

	const searchInput = page.locator("#search-bar input");
	const searchPanel = page.locator("#search-panel");
	const helloWorldResult = searchPanel.locator('a[href="/posts/hello-world/"]');
	await searchInput.fill("Hello");
	await expect(helloWorldResult).toBeVisible();
	await searchInput.fill("");
	await expect(helloWorldResult).toHaveCount(0);

	await page.evaluate(() => {
		const testWindow = window as Window & {
			__releaseSearch?: () => void;
			__searchStarted?: Promise<void>;
		};
		let markSearchStarted: () => void = () => {};
		let releaseSearch: () => void = () => {};
		testWindow.__searchStarted = new Promise<void>((resolve) => {
			markSearchStarted = resolve;
		});
		const searchRelease = new Promise<void>((resolve) => {
			releaseSearch = resolve;
		});
		testWindow.__releaseSearch = releaseSearch;
		window.pagefind = {
			search: async () => ({
				results: [
					{
						data: async () => {
							markSearchStarted();
							await searchRelease;
							return {
								url: "/posts/hello-world/",
								meta: { title: "Hello World" },
								excerpt: "Hello World",
							};
						},
					},
				],
			}),
		};
	});

	await searchInput.fill("Delayed");
	await page.evaluate(
		() =>
			(
				window as Window & {
					__searchStarted?: Promise<void>;
				}
			).__searchStarted,
	);
	await searchInput.fill("");
	await page.evaluate(() => {
		(
			window as Window & {
				__releaseSearch?: () => void;
			}
		).__releaseSearch?.();
	});
	await page.evaluate(
		() =>
			new Promise<void>((resolve) => {
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
			}),
	);

	await expect(helloWorldResult).toHaveCount(0);
	await expect(searchPanel).toHaveClass(/float-panel-closed/);
});

test("custom 404 returns not found and offers recovery links", async ({
	page,
}) => {
	const response = await page.goto("/missing-page/", { waitUntil: "load" });
	expect(response?.status()).toBe(404);

	await expect(
		page.getByRole("heading", {
			level: 1,
			name: "ページが見つかりません",
		}),
	).toBeVisible();
	await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
		"content",
		"noindex",
	);
	await expect(
		page.getByRole("link", { name: "ホームへ戻る" }),
	).toHaveAttribute("href", "/");
	await expect(page.getByRole("link", { name: "記事を探す" })).toHaveAttribute(
		"href",
		"/archive/",
	);
});

test("theme switch enables dark mode and persists it", async ({ page }) => {
	await page.addInitScript(() => {
		if (localStorage.getItem("theme") === null) {
			localStorage.setItem("theme", "light");
		}
	});
	await page.goto("/", { waitUntil: "load" });
	// ネイティブの button ロール。以前は role="menuitem" が付いていたが、
	// 親に role="menu" が必要になり (menu の子は menuitem 系のみ許される)、
	// パネル内のテーマ選択ボタンが不正な子として aria-required-children に落ちていた。
	const switchButton = page.getByRole("button", {
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
