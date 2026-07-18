import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/vrt",
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	ignoreSnapshots: !process.env.CI,
	retries: 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
	snapshotPathTemplate:
		"{testDir}/__screenshots__/{testFileName}/{arg}-{projectName}{ext}",
	expect: {
		toHaveScreenshot: {
			animations: "disabled",
			caret: "hide",
			scale: "css",
		},
	},
	use: {
		baseURL: "http://127.0.0.1:4321",
		locale: "ja-JP",
		reducedMotion: "reduce",
		timezoneId: "Asia/Tokyo",
	},
	projects: [
		{
			name: "desktop-light",
			use: {
				...devices["Desktop Chrome"],
				viewport: { width: 1280, height: 720 },
				colorScheme: "light",
			},
		},
		{
			name: "mobile-width-light",
			use: {
				...devices["Desktop Chrome"],
				viewport: { width: 390, height: 844 },
				colorScheme: "light",
			},
		},
		{
			name: "desktop-dark",
			use: {
				...devices["Desktop Chrome"],
				viewport: { width: 1280, height: 720 },
				colorScheme: "dark",
			},
		},
	],
	webServer: {
		command: "pnpm preview --host 127.0.0.1 --port 4321",
		url: "http://127.0.0.1:4321/",
		reuseExistingServer: !process.env.CI,
		timeout: 60_000,
	},
});
