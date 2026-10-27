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

		// count() does not wait, and /archive/ renders its list in a client:only
		// island after load; toBeVisible() retries until the element appears
		await expect(page.locator(item.ready).first()).toBeVisible();
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
		// window.pagefind の型は src/global.d.ts にあるが、tsconfig の include 外なのでここで足す
		const testWindow = window as Window & {
			__releaseSearch?: () => void;
			__searchStarted?: Promise<void>;
			pagefind?: unknown;
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
		testWindow.pagefind = {
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

test("robots.txt keeps build assets crawlable and advertises the sitemap", async ({
	request,
}) => {
	const response = await request.get("/robots.txt");
	expect(response.status()).toBe(200);
	const body = await response.text();

	// Astro のスタイル / スクリプト / 画像はすべて /_astro/ 配下に出る。ここを
	// Disallow すると Googlebot がページをレンダリングできない (fuwari の既定値が
	// そうなっており、Search Console で 20/23 件のリソースがブロック扱いだった)。
	const disallowed = body
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => /^Disallow:/i.test(line))
		.map((line) => line.slice("Disallow:".length).trim())
		.filter((prefix) => prefix !== "");
	const asset = "/_astro/Layout.DN277Tmi.css";
	expect(disallowed.filter((prefix) => asset.startsWith(prefix))).toEqual([]);

	expect(body).toContain("Sitemap: https://necofuryai.dev/sitemap-index.xml");
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

test("about page lists open source contributions with a status on each", async ({
	page,
}) => {
	// The list is static HTML; the page must not call the GitHub API at runtime
	const githubApiRequests: string[] = [];
	page.on("request", (request) => {
		if (new URL(request.url()).hostname === "api.github.com") {
			githubApiRequests.push(request.url());
		}
	});
	await page.goto("/about/", { waitUntil: "load" });

	const section = page.locator(
		'section[aria-labelledby="open-source-heading"]',
	);
	await expect(
		section.getByRole("heading", { level: 2, name: "Open Source" }),
	).toBeVisible();
	await expect(section.locator(":scope > p time")).toHaveAttribute(
		"datetime",
		/^\d{4}-\d{2}-\d{2}$/,
	);

	const entries = await section.locator(":scope > ol > li").all();
	expect(entries.length).toBeGreaterThan(0);
	const openedDates: (string | null)[] = [];
	for (const entry of entries) {
		await expect(
			entry.locator('h3 a[href^="https://github.com/"]'),
		).toHaveCount(1);
		// A RegExp is matched against the raw text, which keeps the markup's whitespace
		await expect(entry.locator("[data-status-tone]")).toHaveText(
			/^\s*(Released|Merged|In review|Awaiting review)\s*$/,
		);
		// Astro keeps line breaks around inline elements, which would render as "2026 ."
		expect(await entry.innerText()).not.toMatch(/\s[.,;:](\s|$)/);
		openedDates.push(
			await entry
				.locator("p", { hasText: "Opened" })
				.locator("time")
				.getAttribute("datetime"),
		);
	}
	// The intro promises newest first
	expect(openedDates).toEqual([...openedDates].sort().reverse());

	await page.waitForLoadState("networkidle");
	expect(githubApiRequests).toEqual([]);
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

test("desktop home banner rules shift the grid and keep the sidebar sticky offset", async ({
	page,
}) => {
	// Tailwind v4 では @layer 内のクラスに lg: バリアントが付かず、トップでも記事ページと
	// 同じ 35vh の帯になっていた。#sidebar-sticky のルールがユーティリティ top-4 に負けない
	// ことも確かめる。遷移アニメーション中の値を読まないよう transition は止める。
	const readBannerLayout = async () => {
		await page.addStyleTag({
			content: "*, *::before, *::after { transition: none !important; }",
		});
		await expect(page.locator("body")).toHaveClass(/\benable-banner\b/);
		return {
			extend: await page.evaluate(() =>
				Number.parseFloat(
					getComputedStyle(document.documentElement).getPropertyValue(
						"--banner-height-extend",
					),
				),
			),
			gridTranslate: await page
				.locator("#main-grid")
				.evaluate((el) => getComputedStyle(el).translate),
			sidebarTop: await page
				.locator("#sidebar-sticky")
				.evaluate((el) => getComputedStyle(el).top),
		};
	};

	await page.goto("/", { waitUntil: "load" });
	const home = await readBannerLayout();
	expect(home.extend).toBeGreaterThan(0);
	expect(home.gridTranslate).toBe(`0px ${home.extend}px`);
	expect(home.sidebarTop).toBe(`${16 - home.extend}px`);

	await page.goto("/archive/", { waitUntil: "load" });
	const archive = await readBannerLayout();
	expect(archive.gridTranslate).toBe("none");
	expect(archive.sidebarTop).toBe("16px");
});

// こでびる様の X のプロフィール。バナーのピル、フッター、プロフィール欄が指す
const CREDIT_HREF = "https://x.com/kodebiru2";

test("banner and avatar use the prepared WebP images and credit the artist", async ({
	page,
}) => {
	// CI は SITE_ASSETS_SOURCE=placeholder で同じ寸法の仮の画像を使う。原画が無くても
	// srcset の幅と URL、クレジットのリンクは本番と同じになる。
	await page.goto("/", { waitUntil: "load" });

	const banner = page.locator("#banner img");
	await expect(banner).toHaveCount(1);
	await expect(banner).toHaveAttribute("fetchpriority", "high");
	await expect(banner).toHaveAttribute("width", "3840");
	const candidates = ((await banner.getAttribute("srcset")) ?? "")
		.split(",")
		.map((candidate) => candidate.trim().split(/\s+/));
	expect(candidates.map(([, width]) => width)).toEqual([
		"1366w",
		"1920w",
		"2560w",
		"2880w",
		"3200w",
		"3840w",
	]);
	for (const [candidateUrl] of candidates) {
		expect(candidateUrl).toMatch(/^\/_astro\/witch-banner\.[\w-]+\.webp$/);
	}
	await expect
		.poll(() =>
			banner.evaluate((img: HTMLImageElement) =>
				img.complete ? img.naturalWidth : 0,
			),
		)
		.toBeGreaterThan(0);

	const credit = page.locator("#banner-credit");
	await expect(credit).toHaveAttribute("href", CREDIT_HREF);
	await expect(credit).toContainText("Illustration: こでびる");

	// フッターは名前だけをリンクにし、"Illustration:" はリンクの外に置く
	const footerCredit = page
		.locator(`.footer a[href="${CREDIT_HREF}"]`)
		.filter({ visible: true });
	await expect(footerCredit).toHaveText("こでびる");
	await expect(footerCredit).toHaveAttribute("rel", "noopener");
	// フッターは PC 用とスマホ用の 2 つがあり、見えているのは片方だけ
	await expect(page.locator(".footer").filter({ visible: true })).toContainText(
		"Illustration: こでびる",
	);

	// プロフィール欄の紹介文の下にも、名前だけをリンクにして載せる
	const profileCredit = page.locator(`#sidebar a[href="${CREDIT_HREF}"]`);
	await expect(profileCredit).toHaveText("こでびる");
	await expect(profileCredit).toHaveAttribute("target", "_blank");
	await expect(profileCredit).toHaveAttribute("rel", "noopener");
	await expect(profileCredit.locator("..")).toContainText(
		"icon & header: こでびる 様",
	);
	await expect(page.locator('a[href*="coconala.com"]')).toHaveCount(0);

	const avatar = page.locator('img[alt="Profile Image of the Author"]');
	await expect(avatar).toHaveAttribute(
		"src",
		/^\/_astro\/witch-avatar\.[\w-]+\.webp$/,
	);
	await expect(avatar).toHaveAttribute("width", "1024");
});

test("pages share the prepared 1200x630 JPEG as the default social image", async ({
	page,
	request,
}) => {
	// CI は仮の画像から切り抜く。URL、寸法の宣言、配信の形式は本番と同じになる
	const expected = "https://necofuryai.dev/og/witch-banner.jpg";
	for (const path of ["/", "/posts/hello-world/"]) {
		await page.goto(path, { waitUntil: "load" });
		const meta = (selector: string) => page.locator(`head ${selector}`);
		await expect(meta('meta[property="og:image"]')).toHaveAttribute(
			"content",
			expected,
		);
		await expect(meta('meta[name="twitter:image"]')).toHaveAttribute(
			"content",
			expected,
		);
		await expect(meta('meta[property="og:image:type"]')).toHaveAttribute(
			"content",
			"image/jpeg",
		);
		await expect(meta('meta[property="og:image:width"]')).toHaveAttribute(
			"content",
			"1200",
		);
		await expect(meta('meta[property="og:image:height"]')).toHaveAttribute(
			"content",
			"630",
		);
		await expect(meta('meta[property="og:image:alt"]')).toHaveAttribute(
			"content",
			/こでびる/,
		);
		await expect(meta('meta[name="twitter:image:alt"]')).toHaveAttribute(
			"content",
			/こでびる/,
		);
	}
	// 記事の JSON-LD も同じ画像を指す
	const jsonLd = JSON.parse(
		(await page.locator('script[type="application/ld+json"]').textContent()) ??
			"{}",
	);
	expect(jsonLd.image).toBe(expected);

	// request は page.route を通らないので、外部への中断の対象にならない
	const response = await request.get(new URL(expected).pathname);
	expect(response.status()).toBe(200);
	expect(response.headers()["content-type"]).toMatch(/^image\/jpeg\b/);
	expect([...(await response.body()).subarray(0, 3)]).toEqual([
		0xff, 0xd8, 0xff,
	]);
});

test("pages link the favicons resized from the avatar", async ({
	page,
	request,
}) => {
	// CI は仮の画像から縮小する。パス、寸法の宣言、配信の形式は本番と同じになる
	const expected = [32, 128, 180, 192].map((size) => ({
		href: `/favicon/witch-avatar-${size}.png`,
		sizes: `${size}x${size}`,
		media: null,
	}));
	for (const path of ["/", "/posts/hello-world/"]) {
		await page.goto(path, { waitUntil: "load" });
		const icons = await page
			.locator('head link[rel="icon"]')
			.evaluateAll((links) =>
				links.map((link) => ({
					href: link.getAttribute("href"),
					sizes: link.getAttribute("sizes"),
					media: link.getAttribute("media"),
				})),
			);
		expect(icons).toEqual(expected);
	}

	// request は page.route を通らないので、外部への中断の対象にならない
	for (const { href, sizes } of expected) {
		const response = await request.get(href);
		expect(response.status()).toBe(200);
		expect(response.headers()["content-type"]).toMatch(/^image\/png\b/);
		// PNG の署名と、IHDR に書かれた幅と高さ (ビッグエンディアン)
		const body = await response.body();
		expect([...body.subarray(0, 8)]).toEqual([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		]);
		expect(`${body.readUInt32BE(16)}x${body.readUInt32BE(20)}`).toBe(sizes);
	}
	// テンプレートの favicon はもう配信しない
	const template = await request.get("/favicon/favicon-light-32.png");
	expect(template.status()).toBe(404);
});

// 依頼時のガイドの顔の枠 (3840x2160 の原画での座標)。原画は使わず、同じ寸法の仮の
// 画像の描画位置から写像する
const GUIDE = {
	width: 3840,
	height: 2160,
	face: { left: 1100, right: 2740, top: 940, bottom: 1260 },
} as const;

async function measureBannerCredit(page: Page) {
	return page.evaluate(async ({ width, height, face }) => {
		// バナーの transition とクレジットの onload-animation が終わってから測る
		await Promise.all(
			["banner-wrapper", "main-grid"].flatMap((id) =>
				(document.getElementById(id)?.getAnimations({ subtree: true }) ?? [])
					.filter(
						(animation) =>
							animation.effect?.getComputedTiming().endTime !==
							Number.POSITIVE_INFINITY,
					)
					.map((animation) => animation.finished.catch(() => undefined)),
			),
		);
		const rect = (selector: string) => {
			const element = document.querySelector(selector);
			if (!element) throw new Error(`${selector} not found`);
			return element.getBoundingClientRect();
		};
		const img = rect("#banner img");
		const [px, py] = getComputedStyle(
			document.querySelector("#banner img") as Element,
		)
			.objectPosition.split(" ")
			.map((value) => Number.parseFloat(value) / 100);
		const scale = Math.max(img.width / width, img.height / height);
		const ox = img.left + (img.width - width * scale) * px;
		const oy = img.top + (img.height - height * scale) * py;
		const credit = rect("#banner-credit");
		const hit = document.elementFromPoint(
			(credit.left + credit.right) / 2,
			(credit.top + credit.bottom) / 2,
		);
		return {
			credit: {
				left: credit.left,
				top: credit.top,
				right: credit.right,
				bottom: credit.bottom,
			},
			face: {
				left: ox + face.left * scale,
				top: oy + face.top * scale,
				right: ox + face.right * scale,
				bottom: oy + face.bottom * scale,
			},
			textWidth: rect("#banner-credit > div").width,
			navbarBottom: rect("#navbar-wrapper").bottom,
			gridTop: rect("#main-grid").top,
			creditOnTop: Boolean(hit?.closest("#banner-credit")),
		};
	}, GUIDE);
}

// 背の低いスマホでは、顔の枠が画面の幅をほぼ横切るので、クレジットは枠の下の帯
// (枠の下端からカードの上端まで) に収める。390x750 と 375x627 は、実機の Safari の
// vh (ツールバーを除いた高さ) に近い値
for (const [width, height] of [
	[375, 667],
	[360, 780],
	[390, 750],
	[375, 627],
] as const) {
	for (const path of ["/", "/posts/hello-world/"]) {
		test(`banner credit clears the guide face box at ${width}x${height} ${path}`, async ({
			page,
		}) => {
			await page.setViewportSize({ width, height });
			await page.goto(path, { waitUntil: "load" });
			const credit = page.locator("#banner-credit");
			await expect(credit).toBeVisible();
			await expect(page.locator("#banner")).not.toHaveClass(/scale-105/);
			const m = await measureBannerCredit(page);
			const clear =
				m.credit.top >= m.face.bottom + 2 ||
				m.credit.bottom <= m.face.top - 2 ||
				m.credit.left >= m.face.right + 2 ||
				m.credit.right <= m.face.left - 2;
			expect(
				clear,
				`credit ${JSON.stringify(m.credit)} vs face ${JSON.stringify(m.face)}`,
			).toBe(true);
			// バナーの見える帯に収まり、ほかの要素に覆われない
			expect(m.credit.top).toBeGreaterThanOrEqual(m.navbarBottom);
			expect(m.credit.bottom).toBeLessThanOrEqual(m.gridTop);
			expect(m.creditOnTop).toBe(true);
			expect(m.textWidth).toBeGreaterThan(60);
			await expect(credit).toHaveAccessibleName(/Illustration: こでびる/);
		});
	}
}

test("banner credit hides where it would reach the face or the band cannot hold it, and the footer and profile still credit the artist", async ({
	page,
}) => {
	// 375x553 と 390x580 は顔の枠に 2px 以内まで近づく高さ。844x390 と 667x375 は
	// ナビバーとカードの間に収まらない横向きの画面
	for (const [width, height] of [
		[375, 553],
		[390, 580],
		[844, 390],
		[667, 375],
	] as const) {
		await page.setViewportSize({ width, height });
		await page.goto("/posts/hello-world/", { waitUntil: "load" });
		await expect(page.locator("#banner-credit")).toBeHidden();
		await expect(
			page
				.locator(`.footer a[href="${CREDIT_HREF}"]`)
				.filter({ visible: true }),
		).toHaveText("こでびる");
		await expect(
			page.locator(".footer").filter({ visible: true }),
		).toContainText("Illustration: こでびる");
		await expect(
			page
				.locator(`#sidebar a[href="${CREDIT_HREF}"]`)
				.filter({ visible: true }),
		).toHaveText("こでびる");
	}
});

test("desktop keeps the banner credit pill above the cards", async ({
	page,
}) => {
	for (const path of ["/", "/posts/hello-world/"]) {
		await page.goto(path, { waitUntil: "load" });
		await expect(page.locator("#banner-credit")).toBeVisible();
		const m = await measureBannerCredit(page);
		const gridRight = await page
			.locator("#main-grid")
			.evaluate((element) => element.getBoundingClientRect().right);
		expect(m.credit.bottom - m.credit.top).toBeCloseTo(36, 0);
		expect(m.credit.top).toBeCloseTo(m.gridTop - 52, 0);
		expect(m.credit.right).toBeCloseTo(gridRight - 16, 0);
		expect(m.creditOnTop).toBe(true);
	}
});

test("dark mode fades the banner's bottom edge inside the card overlap", async ({
	page,
}) => {
	// project は colorScheme: "light" 固定なので、テーマは localStorage とボタンで選ぶ
	await page.addInitScript(() => {
		if (localStorage.getItem("theme") === null) {
			localStorage.setItem("theme", "light");
		}
	});
	const html = page.locator("html");
	const wrapper = page.locator("#banner-wrapper");
	const maskImage = () =>
		wrapper.evaluate((element) =>
			getComputedStyle(element).getPropertyValue("mask-image"),
		);

	await page.goto("/", { waitUntil: "load" });
	await expect(html).not.toHaveClass(/\bdark\b/);
	expect(await maskImage()).toBe("none");

	await page.getByRole("button", { name: "Light/Dark Mode" }).click();
	await expect(html).toHaveClass(/\bdark\b/);
	await expect.poll(maskImage).toContain("linear-gradient");

	// フェードの長さは、カードの上端からバナーの下端までの重なりと同じ。トップ (wrapper
	// ごと translate する) と記事 (#banner だけがずれる) の両方で確かめる
	for (const path of ["/", "/posts/hello-world/"]) {
		await page.goto(path, { waitUntil: "load" });
		await page.addStyleTag({
			content: "*, *::before, *::after { transition: none !important; }",
		});
		await expect(html).toHaveClass(/\bdark\b/);
		expect(await maskImage()).toContain("linear-gradient");
		const { fade, overlap } = await wrapper.evaluate((element) => {
			const rootFontSize = Number.parseFloat(
				getComputedStyle(document.documentElement).fontSize,
			);
			const grid = document.getElementById("main-grid");
			return {
				fade:
					Number.parseFloat(
						getComputedStyle(element).getPropertyValue("--banner-fade-length"),
					) * rootFontSize,
				overlap: grid
					? element.getBoundingClientRect().bottom -
						grid.getBoundingClientRect().top
					: Number.NaN,
			};
		});
		expect(fade).toBe(56);
		expect(overlap).toBeCloseTo(fade, 0);
	}

	// md 未満はカードが全幅でバナーの下端を覆うので、ダークでも掛けない
	await page.setViewportSize({ width: 375, height: 667 });
	expect(await maskImage()).toBe("none");
});
