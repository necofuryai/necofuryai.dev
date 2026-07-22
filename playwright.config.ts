import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/ui",
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
	use: {
		baseURL: "http://127.0.0.1:4325",
		locale: "ja-JP",
		reducedMotion: "reduce",
		timezoneId: "Asia/Tokyo",
		trace: "retain-on-failure",
	},
	projects: [
		{
			name: "desktop",
			use: {
				...devices["Desktop Chrome"],
				viewport: { width: 1280, height: 720 },
				colorScheme: "light",
			},
		},
	],
	webServer: {
		command: "pnpm preview --host 127.0.0.1 --port 4325",
		url: "http://127.0.0.1:4325/",
		reuseExistingServer: false,
		timeout: 60_000,
	},
});
