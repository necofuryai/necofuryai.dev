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
	// The closed search panel keeps its input out of view and out of the Tab order
	await expect(mobileSearch).toBeHidden();
	await page.locator("#search-switch").click();
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

// Replace Pagefind with a search whose single Hello World result stays pending
// until releaseHeldSearch(); waitForHeldSearch() resolves once it has started
async function holdNextSearch(page: Page) {
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
}

async function waitForHeldSearch(page: Page) {
	await page.evaluate(
		() =>
			(
				window as Window & {
					__searchStarted?: Promise<void>;
				}
			).__searchStarted,
	);
}

async function releaseHeldSearch(page: Page) {
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
}

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

	await holdNextSearch(page);
	await searchInput.fill("Delayed");
	await waitForHeldSearch(page);
	await searchInput.fill("");
	await releaseHeldSearch(page);

	await expect(helloWorldResult).toHaveCount(0);
	await expect(searchPanel).toHaveClass(/float-panel-closed/);
});

// The navbar is a single flex row. When it runs out of room its controls either
// overflow the card or get squeezed, so check both: every visible control stays
// inside the card's content box, and the square buttons stay square. A page
// scroll check would miss this, because a small overflow stays in the viewport.
async function expectNavbarRowInsideCard(page: Page, label: string) {
	const row = await page.evaluate(() => {
		const card = document.querySelector("#navbar > .card-base");
		if (!card) throw new Error("#navbar > .card-base not found");
		const box = card.getBoundingClientRect();
		const style = getComputedStyle(card);
		return {
			left: box.left + Number.parseFloat(style.paddingLeft),
			right: box.right - Number.parseFloat(style.paddingRight),
			controls: [...card.querySelectorAll("a, button, input")]
				.filter(
					(element) =>
						element.getBoundingClientRect().width > 0 &&
						!element.closest(".float-panel, #light-dark-panel"),
				)
				.map((element) => {
					const rect = element.getBoundingClientRect();
					return {
						name:
							element.getAttribute("aria-label") ||
							element.id ||
							element.textContent?.trim(),
						button: element.tagName === "BUTTON",
						left: rect.left,
						right: rect.right,
						width: rect.width,
						height: rect.height,
					};
				}),
		};
	});
	expect(row.controls.length, label).toBeGreaterThan(3);
	for (const control of row.controls) {
		const where = `${control.name} at ${label}`;
		expect(control.left, where).toBeGreaterThanOrEqual(row.left - 0.5);
		expect(control.right, where).toBeLessThanOrEqual(row.right + 0.5);
		if (control.button) {
			expect(control.width, where).toBeCloseTo(control.height, 0);
		}
	}
}

test("the navbar row fits its card and moves the links into the menu below lg", async ({
	page,
}) => {
	// The links share the lg breakpoint with the desktop search field, and the
	// root font size changes at md, so check both sides of md and lg. 320px is
	// the width WCAG 1.4.10 asks content to reflow at; below 360px the site
	// title drops its home icon to fit
	for (const [width, height, inlineLinks] of [
		[320, 640, false],
		[359, 780, false],
		[360, 780, false],
		[767, 1024, false],
		[768, 1024, false],
		[834, 1112, false],
		[1023, 768, false],
		[1024, 768, true],
		[1280, 720, true],
	] as const) {
		await page.setViewportSize({ width, height });
		await page.goto("/", { waitUntil: "load" });
		// The theme switch and the search toggle are client:only islands
		await expect(page.locator("#scheme-switch")).toBeVisible();
		const aboutLink = page.locator('#navbar a[aria-label="About"]');
		const menuSwitch = page.locator("#nav-menu-switch");
		if (inlineLinks) {
			await expect(aboutLink).toBeVisible();
			await expect(menuSwitch).toBeHidden();
			await expect(page.locator("#site-search-desktop")).toBeVisible();
		} else {
			await expect(aboutLink).toBeHidden();
			await expect(menuSwitch).toBeVisible();
			await expect(page.locator("#search-switch")).toBeVisible();
		}
		await expectNavbarRowInsideCard(page, `${width}x${height}`);

		if (!inlineLinks) {
			await menuSwitch.click();
			const menuAbout = page.locator('#nav-menu-panel a[href="/about/"]');
			await expect(menuAbout).toBeVisible();
			const menuRight = await page
				.locator("#nav-menu-panel")
				.evaluate((panel) => panel.getBoundingClientRect().right);
			expect(menuRight).toBeLessThanOrEqual(width);
		}
	}
});

test("a focused desktop search field keeps the navbar row inside its card", async ({
	page,
}) => {
	// The field grows on focus. Below xl it grows less, because at 1024px the
	// full width would push the theme buttons past the card
	for (const [width, height, focusedWidth] of [
		[1024, 768, 192],
		[1279, 800, 192],
		[1280, 720, 240],
	] as const) {
		await page.setViewportSize({ width, height });
		await page.goto("/", { waitUntil: "load" });
		await expect(page.locator("#scheme-switch")).toBeVisible();
		// Measure the grown field, not a frame of its width transition
		await page.addStyleTag({
			content: "#site-search-desktop { transition: none !important; }",
		});
		const searchInput = page.locator("#site-search-desktop");
		await searchInput.focus();
		await expect(searchInput).toHaveCSS("width", `${focusedWidth}px`);
		await expectNavbarRowInsideCard(page, `${width}x${height} focused`);
	}
});

test("Tab skips the controls of closed float panels", async ({ page }) => {
	// A closed panel only fades out, and neither opacity nor pointer-events
	// takes its links and inputs out of the Tab order. Walk the Tab order from
	// the top of the page past the navbar and check that focus never enters a
	// closed panel. The light/dark panel opens when focus reaches its switch.
	for (const [width, height] of [
		[390, 844],
		[1280, 720],
	] as const) {
		await page.setViewportSize({ width, height });
		await page.goto("/", { waitUntil: "load" });
		await expect(page.locator("#scheme-switch")).toBeVisible();
		await expect(page.locator("#display-setting")).toHaveCount(1);
		await expect(page.locator("#search-panel")).toHaveCount(1);

		const stops: {
			name: string;
			inClosedPanel: boolean;
			inThemePanel: boolean;
			inNavbar: boolean;
		}[] = [];
		for (let i = 0; i < 30; i++) {
			await page.keyboard.press("Tab");
			const stop = await page.evaluate(() => {
				const active = document.activeElement;
				if (!active || active === document.body) return null;
				return {
					name:
						active.getAttribute("aria-label") ||
						active.id ||
						active.textContent?.trim().slice(0, 40) ||
						active.tagName,
					inClosedPanel: Boolean(active.closest(".float-panel-closed")),
					inThemePanel: Boolean(active.closest("#light-dark-panel")),
					inNavbar: Boolean(active.closest("#navbar")),
				};
			});
			if (stop) stops.push(stop);
			if (stop && !stop.inNavbar) break;
		}
		expect(
			stops.filter((stop) => stop.inClosedPanel).map((stop) => stop.name),
			`${width}x${height}`,
		).toEqual([]);
		// The walk went through the navbar and reached the page content after it
		expect(stops.map((stop) => stop.name)).toContain("Light/Dark Mode");
		expect(stops.at(-1)?.inNavbar, `${width}x${height}`).toBe(false);
		// From lg the theme panel is the only way to pick light, dark, or system
		// by keyboard, so the walk must open it and visit its three buttons
		if (width >= 1024) {
			expect(stops.filter((stop) => stop.inThemePanel)).toHaveLength(3);
		}
	}
});

test("float panels close when a link inside them is followed", async ({
	page,
}) => {
	// The navbar sits outside the Swup containers and survives each visit, and a
	// click inside a panel does not count as a click outside it
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/", { waitUntil: "load" });
	await page.evaluate(() => {
		(
			window as Window & { __uiSmokeSwupSentinel?: boolean }
		).__uiSmokeSwupSentinel = true;
	});

	// A link to the current page only scrolls, so Swup starts no visit. Chosen
	// by keyboard, the link would keep focus while it hides, so focus goes back
	// to the menu button
	const menuSwitch = page.locator("#nav-menu-switch");
	const menuPanel = page.locator("#nav-menu-panel");
	const menuHome = menuPanel.locator('a[href="/"]');
	await menuSwitch.click();
	await expect(menuHome).toBeVisible();
	await menuHome.focus();
	await page.keyboard.press("Enter");
	await expect(menuPanel).toHaveClass(/float-panel-closed/);
	await expect(menuHome).toBeHidden();
	await expect(menuSwitch).toBeFocused();
	expect(new URL(page.url()).pathname).toBe("/");

	const menuArchive = menuPanel.locator('a[href="/archive/"]');
	await page.locator("#nav-menu-switch").click();
	await expect(menuArchive).toBeVisible();
	await Promise.all([page.waitForURL("**/archive/"), menuArchive.click()]);
	await expect(menuPanel).toHaveClass(/float-panel-closed/);
	await expect(menuArchive).toBeHidden();

	// A search still pending when the visit starts must not reopen the panel.
	// Nor may the Pagefind loader run again: re-run on content:replace, it fired
	// pagefindready, and the search reopened the panel with the old keyword.
	await page.setViewportSize({ width: 1280, height: 720 });
	const searchInput = page.locator("#site-search-desktop");
	const searchPanel = page.locator("#search-panel");
	const helloWorldResult = searchPanel.locator('a[href="/posts/hello-world/"]');
	await searchInput.fill("Hello");
	await expect(helloWorldResult).toBeVisible();
	await page.evaluate(() => {
		const testWindow = window as Window & {
			__visitEnded?: Promise<void>;
			swup?: {
				hooks: { once: (hook: string, handler: () => void) => void };
			};
		};
		// Swup's scripts plugin replaces a script it runs again with a copy,
		// and a copy does not keep this property
		const loader = [...document.scripts].find((script) =>
			script.textContent?.includes("/pagefind/pagefind.js"),
		) as (HTMLScriptElement & { __uiSmokeOriginal?: boolean }) | undefined;
		if (!loader) throw new Error("Pagefind loader script not found");
		loader.__uiSmokeOriginal = true;
		testWindow.__visitEnded = new Promise<void>((resolve) => {
			testWindow.swup?.hooks.once("visit:end", () => resolve());
		});
	});
	await holdNextSearch(page);
	await searchInput.fill("Delayed");
	await waitForHeldSearch(page);
	await Promise.all([
		page.waitForURL("**/posts/hello-world/"),
		helloWorldResult.click(),
	]);
	await expect(searchPanel).toHaveClass(/float-panel-closed/);
	await page.evaluate(
		() => (window as Window & { __visitEnded?: Promise<void> }).__visitEnded,
	);
	await releaseHeldSearch(page);
	await expect(searchPanel).toHaveClass(/float-panel-closed/);
	await expect(helloWorldResult).toBeHidden();
	expect(
		await page.evaluate(() => {
			const loader = [...document.scripts].find((script) =>
				script.textContent?.includes("/pagefind/pagefind.js"),
			) as (HTMLScriptElement & { __uiSmokeOriginal?: boolean }) | undefined;
			return loader?.__uiSmokeOriginal;
		}),
	).toBe(true);

	expect(
		await page.evaluate(
			() =>
				(window as Window & { __uiSmokeSwupSentinel?: boolean })
					.__uiSmokeSwupSentinel,
		),
	).toBe(true);
});

test("the theme color reset button shows only after the hue changes and hands focus to the slider", async ({
	page,
}) => {
	await page.goto("/", { waitUntil: "load" });
	const defaultHue = await page
		.locator("#config-carrier")
		.getAttribute("data-hue");
	if (!defaultHue) throw new Error("#config-carrier has no data-hue");
	await page.locator("#display-settings-switch").click();
	const reset = page.locator(
		'#display-setting button[aria-label="Reset to Default"]',
	);
	const slider = page.locator("#colorSlider");
	await expect(slider).toBeVisible();

	// At the default hue the button would do nothing, so it is neither shown
	// nor a Tab stop
	await expect(reset).toBeHidden();
	await slider.fill(defaultHue === "100" ? "200" : "100");
	await expect(reset).toBeVisible();

	// Resetting hides the button under the keyboard user's focus, so focus moves
	// on to the slider instead of falling back to the page
	await reset.focus();
	await page.keyboard.press("Enter");
	await expect(slider).toHaveValue(defaultHue);
	await expect(reset).toBeHidden();
	await expect(slider).toBeFocused();
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

// Resolves CSS color values in the page. A fresh probe per value: the site gives
// every span a color transition, so recoloring one probe would read back the
// previous color
function resolveColors(page: Page, values: readonly string[]) {
	return page.evaluate(
		(values) =>
			values.map((value) => {
				const probe = document.createElement("span");
				probe.style.transition = "none";
				probe.style.color = value;
				document.body.append(probe);
				const color = getComputedStyle(probe).color;
				probe.remove();
				return color;
			}),
		values,
	);
}

async function reloadInDarkMode(page: Page) {
	await page.evaluate(() => localStorage.setItem("theme", "dark"));
	await page.reload({ waitUntil: "load" });
	await expect(page.locator("html")).toHaveClass(/dark/);
}

test("links use the readable --primary-text color in both themes", async ({
	page,
}) => {
	// tests/unit/color-contrast.test.mjs checks the token values; this checks
	// that links are wired to the token rather than to the accent --primary
	const readColors = async () => {
		const [primaryText, primary] = await resolveColors(page, [
			"var(--primary-text)",
			"var(--primary)",
		]);
		const links = await page.evaluate(() =>
			[
				// Headings carry a hidden a.anchor first; check the visible body link
				".custom-md a:not(.anchor)",
				'a[href="/privacy/"]',
				'section[aria-labelledby="open-source-heading"] h3 a',
			].map((selector) => {
				const element = document.querySelector(selector);
				return element ? getComputedStyle(element).color : null;
			}),
		);
		return { primaryText, primary, links };
	};

	await page.goto("/about/", { waitUntil: "load" });
	const light = await readColors();
	expect(light.primaryText).not.toBe(light.primary);
	expect(light.links).toEqual([
		light.primaryText,
		light.primaryText,
		light.primaryText,
	]);

	await reloadInDarkMode(page);
	const dark = await readColors();
	expect(dark.primaryText).toBe(dark.primary);
	expect(dark.links).toEqual([
		dark.primaryText,
		dark.primaryText,
		dark.primaryText,
	]);
});

test("footer and profile links inside text keep an underline in both themes", async ({
	page,
}) => {
	// The link text is close in lightness to the text around it, so the
	// underline is the cue besides color; the unit test checks its contrast
	const decorationsOf = (elements: Element[]) =>
		elements.map((element) => {
			const style = getComputedStyle(element);
			return `${style.textDecorationLine} ${style.textDecorationColor}`;
		});
	const expectUnderlined = async () => {
		const [underline] = await resolveColors(page, ["var(--link-underline)"]);
		const footer = await page
			.locator(".footer")
			.filter({ visible: true })
			.locator("a")
			.evaluateAll(decorationsOf);
		const profile = await page
			.locator(`#sidebar a[href="${CREDIT_HREF}"]`)
			.filter({ visible: true })
			.evaluateAll(decorationsOf);
		expect(footer.length).toBeGreaterThan(0);
		expect(footer).toEqual(footer.map(() => `underline ${underline}`));
		expect(profile).toEqual([`underline ${underline}`]);
	};

	await page.goto("/", { waitUntil: "load" });
	await expectUnderlined();
	await reloadInDarkMode(page);
	await expectUnderlined();
});

test("admonition titles and icons use the readable text tokens in both themes", async ({
	page,
}) => {
	// Only a draft post has admonitions, so build the markup that
	// rehype-component-admonition.mjs emits inside a rendered .custom-md
	const TYPES = ["tip", "note", "important", "warning", "caution"] as const;
	const readTitles = async () => {
		const tokens = await resolveColors(
			page,
			TYPES.flatMap((type) => [
				`var(--admonitions-text-${type})`,
				`var(--admonitions-color-${type})`,
			]),
		);
		const titles = await page.evaluate((types) => {
			const markdown = document.querySelector(".custom-md");
			if (!markdown) throw new Error("The page has no .custom-md");
			return types.map((type) => {
				const admonition = document.createElement("blockquote");
				admonition.className = `admonition bdm-${type}`;
				const title = document.createElement("span");
				title.className = "bdm-title";
				title.textContent = type.toUpperCase();
				admonition.append(title);
				markdown.append(admonition);
				return {
					text: getComputedStyle(title).color,
					icon: getComputedStyle(title, "::before").backgroundColor,
				};
			});
		}, TYPES);
		return TYPES.map((type, i) => ({
			type,
			token: tokens[2 * i],
			accent: tokens[2 * i + 1],
			...titles[i],
		}));
	};

	await page.goto("/about/", { waitUntil: "load" });
	for (const title of await readTitles()) {
		// The accent stays on the side bar and the status badges
		expect(title.token, title.type).not.toBe(title.accent);
		expect([title.text, title.icon], title.type).toEqual([
			title.token,
			title.token,
		]);
	}

	await reloadInDarkMode(page);
	for (const title of await readTitles()) {
		expect([title.text, title.icon, title.accent], title.type).toEqual([
			title.token,
			title.token,
			title.token,
		]);
	}
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

test("the code copy button copies once per click after Swup revisits", async ({
	page,
}) => {
	// Markdown.astro registers the copy handler on document. The build inlines
	// that script, and reloadScripts runs it again on each Swup visit to a page
	// that renders Markdown, so every arrival at About could add a listener.
	// Starting on Playlists, which has no Markdown, also checks that a Swup
	// arrival still registers the handler at all
	type CopySmoke = Window & {
		__uiSmokeCopyCalls?: string[];
		__uiSmokePageLoads?: number;
	};
	await page.goto("/playlists/", { waitUntil: "load" });
	await page.evaluate(() => {
		const smoke = window as CopySmoke;
		smoke.__uiSmokeCopyCalls = [];
		smoke.__uiSmokePageLoads = 0;
		Object.defineProperty(navigator.clipboard, "writeText", {
			configurable: true,
			value: (text: string) => {
				smoke.__uiSmokeCopyCalls?.push(text);
				return Promise.resolve();
			},
		});
		document.addEventListener("astro:page-load", () => {
			smoke.__uiSmokePageLoads = (smoke.__uiSmokePageLoads ?? 0) + 1;
		});
	});

	const playlistsLink = page.locator('#navbar a[aria-label="Playlists"]');
	const aboutLink = page.locator('#navbar a[aria-label="About"]');
	const visits = [
		{ link: aboutLink, url: "**/about/" },
		{ link: playlistsLink, url: "**/playlists/" },
		{ link: aboutLink, url: "**/about/" },
	];
	for (const [index, visit] of visits.entries()) {
		await Promise.all([page.waitForURL(visit.url), visit.link.click()]);
		// astro:page-load fires on Swup's page:view, after the scripts plugin
		// has re-inserted the page scripts on content:replace
		await expect
			.poll(() => page.evaluate(() => (window as CopySmoke).__uiSmokePageLoads))
			.toBe(index + 1);
	}
	await expect(
		page.getByRole("heading", { level: 1, name: "About" }),
	).toBeVisible();

	// No post has a code block yet, so add one in Expressive Code's shape
	await page.locator("main").evaluate((main) => {
		const pre = document.createElement("pre");
		pre.dataset.uiSmokeCopy = "";
		const code = document.createElement("code");
		const line = document.createElement("div");
		line.className = "code";
		line.textContent = "copy me";
		code.append(line);
		const button = document.createElement("button");
		button.className = "copy-btn";
		button.setAttribute("aria-label", "Copy code");
		// The reset CSS leaves an empty button 0px wide, which cannot be clicked
		button.textContent = "Copy";
		pre.append(code, button);
		main.append(pre);
	});
	const copyButton = page
		.locator("pre[data-ui-smoke-copy]")
		.getByRole("button", { name: "Copy code" });
	await copyButton.click();
	await expect(copyButton).toHaveClass(/\bsuccess\b/);
	expect(
		await page.evaluate(() => (window as CopySmoke).__uiSmokeCopyCalls),
	).toEqual(["copy me"]);
});

test("about page declares English while the shared UI stays Japanese across Swup visits", async ({
	page,
}) => {
	await page.goto("/", { waitUntil: "load" });
	await page.evaluate(() => {
		(
			window as Window & { __uiSmokeSwupSentinel?: boolean }
		).__uiSmokeSwupSentinel = true;
	});
	const html = page.locator("html");
	await expect(html).toHaveAttribute("lang", "ja");

	const aboutLink = page.locator('#navbar a[aria-label="About"]');
	await expect(aboutLink).toHaveCount(1);
	await Promise.all([page.waitForURL("**/about/"), aboutLink.click()]);
	await expect(
		page.getByRole("heading", { level: 1, name: "About" }),
	).toBeVisible();
	// Swup replaces only main and #toc; its head plugin copies <html lang>
	await expect(html).toHaveAttribute("lang", "en");
	await expect(page).toHaveTitle("About - necofuryai.dev");
	// The page body inherits English from <html>, while the navbar, sidebar,
	// banner credit, and footer keep their Japanese UI marked as such
	expect(
		await page
			.locator("main h1")
			.evaluate((heading) => heading.closest("[lang]")?.tagName),
	).toBe("HTML");
	await expect(page.locator("#navbar")).toHaveAttribute("lang", "ja");
	await expect(page.locator("#sidebar")).toHaveAttribute("lang", "ja");
	await expect(page.locator("#banner-credit")).toHaveAttribute("lang", "ja");
	await expect(
		page.locator(".footer").filter({ visible: true }).locator("[lang]"),
	).toHaveAttribute("lang", "ja");

	const homeLink = page.locator('#navbar a[aria-label="Home"]');
	await Promise.all([
		page.waitForURL((url) => url.pathname === "/"),
		homeLink.click(),
	]);
	await expect(html).toHaveAttribute("lang", "ja");
	expect(
		await page.evaluate(
			() =>
				(window as Window & { __uiSmokeSwupSentinel?: boolean })
					.__uiSmokeSwupSentinel,
		),
	).toBe(true);
});

test("the About page and the Japanese posts share one search index", async ({
	page,
}) => {
	// Pagefind searches only the index of the <html lang> it starts on, so an
	// index split by language would hide each side from searches on the other
	const searchInput = page.locator("#search-bar input");
	const searchPanel = page.locator("#search-panel");

	await page.goto("/", { waitUntil: "load" });
	await searchInput.fill("observability");
	await expect(searchPanel.locator('a[href="/about/"]')).toBeVisible();

	await page.goto("/about/", { waitUntil: "load" });
	await searchInput.fill("開設");
	await expect(
		searchPanel.locator('a[href="/posts/hello-world/"]'),
	).toBeVisible();
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
