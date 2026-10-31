import type {
	ExpressiveCodeConfig,
	LicenseConfig,
	NavBarConfig,
	ProfileConfig,
	SiteConfig,
} from "./types/config";
import { LinkPreset } from "./types/config";
import { AVATAR_FAVICONS } from "./utils/favicon.mjs";

// The artist of the banner and the avatar, credited in the banner, the footer, and the profile
const ILLUSTRATOR = { name: "こでびる", url: "https://x.com/kodebiru2" };

export const siteConfig: SiteConfig = {
	title: "necofuryai.dev",
	subtitle: "necofuryai の技術ブログ",
	lang: "ja", // Language code, e.g. 'en', 'zh_CN', 'ja', etc.
	themeColor: {
		hue: 250, // Default hue for the theme color, from 0 to 360. e.g. red: 0, teal: 200, cyan: 250, pink: 345
		fixed: false, // Hide the theme color picker for visitors
	},
	banner: {
		enable: true,
		// Written by scripts/prepare-site-assets.mjs before dev and build (not committed; see AGENTS.md "Banner and avatar")
		src: "assets/images/witch-banner.webp", // Set an image path (relative to /src) before enabling. Relative to the /public directory if it starts with '/'
		position: "center", // Equivalent to object-position, only supports 'top', 'center', 'bottom'. 'center' by default
		credit: {
			enable: true, // Display the credit text of the banner image
			label: "Illustration:", // (Optional) Text shown before the credit text; the footer leaves it out of the link
			text: ILLUSTRATOR.name, // Credit text to be displayed
			url: ILLUSTRATOR.url, // (Optional) URL link to the original artwork or artist's page
		},
	},
	toc: {
		enable: true, // Display the table of contents on the right side of the post
		depth: 2, // Maximum heading depth to show in the table, from 1 to 3
	},
	// Resized from the avatar by scripts/prepare-site-assets.mjs, like the banner (not committed)
	favicon: [...AVATAR_FAVICONS],
};

export const navBarConfig: NavBarConfig = {
	// From lg (1024px) the links share the navbar row with the search field.
	// At 1024px only about 20px is left while the field is focused, so make
	// room before adding a link; tests/ui/pages.spec.ts checks that the row fits
	links: [
		LinkPreset.Home,
		LinkPreset.Archive,
		LinkPreset.Playlists,
		LinkPreset.About,
		{
			name: "GitHub",
			url: "https://github.com/necofuryai/necofuryai.dev", // Internal links should not include the base path, as it is automatically added
			external: true, // Show an external link icon and will open in a new tab
		},
	],
};

export const profileConfig: ProfileConfig = {
	// Written by scripts/prepare-site-assets.mjs, like the banner
	avatar: "assets/images/witch-avatar.webp", // Relative to the /src directory. Relative to the /public directory if it starts with '/'
	name: "necofuryai",
	bio: "技術メモと開発記録を書いています。",
	// (Optional) A line under the bio: the label, the text linked to the URL, then the suffix
	credit: {
		label: "icon & header:",
		text: ILLUSTRATOR.name,
		url: ILLUSTRATOR.url,
		suffix: "様",
	},
	links: [
		// Visit https://icones.js.org/ for icon codes
		// You will need to install the corresponding icon set if it's not already included
		// `pnpm add @iconify-json/<icon-set-name>`
		{
			name: "GitHub",
			icon: "fa6-brands:github",
			url: "https://github.com/necofuryai",
		},
		{
			name: "X",
			icon: "fa6-brands:x-twitter",
			url: "https://x.com/necofuryai",
		},
		{
			name: "Kaggle",
			icon: "fa6-brands:kaggle",
			url: "https://www.kaggle.com/necofuryai",
		},
		{
			name: "LeetCode",
			icon: "simple-icons:leetcode",
			url: "https://leetcode.com/u/necofuryai/",
		},
	],
};

export const licenseConfig: LicenseConfig = {
	enable: true,
	name: "CC BY-NC-SA 4.0",
	url: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
};

export const expressiveCodeConfig: ExpressiveCodeConfig = {
	// Note: Some styles (such as background color) are being overridden, see the astro.config.mjs file.
	// Please select a dark theme, as this blog theme currently only supports dark background color
	theme: "github-dark",
};
