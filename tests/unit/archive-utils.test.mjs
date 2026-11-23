import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compile } from "svelte/compiler";
import {
	filterArchivePosts,
	formatArchiveDate,
	groupArchivePostsByYear,
	parseArchiveFilter,
} from "../../src/utils/archive-utils.mjs";

const ARCHIVE_UTILS_URL = new URL(
	"../../src/utils/archive-utils.mjs",
	import.meta.url,
).href;
const ARCHIVE_PANEL_PATH = new URL(
	"../../src/components/ArchivePanel.svelte",
	import.meta.url,
);

const makePost = (slug, published, { tags = [], category = null } = {}) => ({
	slug,
	data: {
		title: slug,
		published: new Date(published),
		tags,
		category,
	},
});

const SAMPLE_POSTS = [
	makePost("hello-world", "2026-07-18T00:00:00.000Z", {
		tags: ["Blog", "Astro"],
		category: "General",
	}),
	makePost("new-year-utc", "2026-01-01T00:00:00.000Z", {
		tags: ["Notes"],
		category: "",
	}),
	makePost("year-end-utc", "2025-12-31T23:59:59.000Z", {
		tags: ["Astro", "Cloudflare"],
		category: "Tech",
	}),
	makePost("uncategorized-null", "2024-03-05T00:00:00.000Z", {
		tags: [],
		category: null,
	}),
];

test("formatArchiveDate formats UTC month and day with zero padding", () => {
	assert.equal(
		formatArchiveDate(new Date("2026-07-18T00:00:00.000Z")),
		"07-18",
	);
	assert.equal(
		formatArchiveDate(new Date("2026-01-01T00:00:00.000Z")),
		"01-01",
	);
	assert.equal(
		formatArchiveDate(new Date("2025-12-31T23:59:59.000Z")),
		"12-31",
	);
	assert.equal(
		formatArchiveDate(new Date("2024-03-05T00:00:00.000Z")),
		"03-05",
	);
});

test("groupArchivePostsByYear groups by UTC year descending and preserves order", () => {
	const groups = groupArchivePostsByYear(SAMPLE_POSTS);
	assert.deepEqual(
		groups.map((group) => ({
			year: group.year,
			slugs: group.posts.map((post) => post.slug),
		})),
		[
			{ year: 2026, slugs: ["hello-world", "new-year-utc"] },
			{ year: 2025, slugs: ["year-end-utc"] },
			{ year: 2024, slugs: ["uncategorized-null"] },
		],
	);
	assert.deepEqual(groupArchivePostsByYear([]), []);
});

test("UTC formatting and year grouping stay identical across negative and positive timezones", () => {
	// Frontmatter dates like `2026-07-18` parse as midnight UTC; local getters
	// would shift 2026-07-18 to 07-17 in America/Los_Angeles (PDT, UTC-7) and
	// 2026-01-01 to 2025-12-31, while shifting 2025-12-31T23:59:59Z to 2026-01-01
	// in Asia/Tokyo (JST, UTC+9).
	const probe = `
		import { formatArchiveDate, groupArchivePostsByYear } from ${JSON.stringify(ARCHIVE_UTILS_URL)};
		const posts = [
			{ slug: "jul", data: { published: new Date("2026-07-18T00:00:00.000Z") } },
			{ slug: "jan", data: { published: new Date("2026-01-01T00:00:00.000Z") } },
			{ slug: "dec", data: { published: new Date("2025-12-31T23:59:59.000Z") } },
		];
		console.log(JSON.stringify({
			dates: posts.map((post) => formatArchiveDate(post.data.published)),
			groups: groupArchivePostsByYear(posts).map((group) => ({
				year: group.year,
				slugs: group.posts.map((post) => post.slug),
			})),
		}));
	`;

	const expected = {
		dates: ["07-18", "01-01", "12-31"],
		groups: [
			{ year: 2026, slugs: ["jul", "jan"] },
			{ year: 2025, slugs: ["dec"] },
		],
	};

	for (const tz of ["America/Los_Angeles", "UTC", "Asia/Tokyo"]) {
		const result = spawnSync(
			process.execPath,
			["--input-type=module", "-e", probe],
			{
				encoding: "utf8",
				env: { ...process.env, TZ: tz },
			},
		);
		assert.equal(result.status, 0, `${tz}: ${result.stderr}`);
		assert.deepEqual(JSON.parse(result.stdout), expected, tz);
	}
});

test("parseArchiveFilter extracts repeated tags, categories, and uncategorized", () => {
	assert.deepEqual(parseArchiveFilter(""), {
		tags: [],
		categories: [],
		uncategorized: false,
	});
	assert.deepEqual(parseArchiveFilter("?tag=Blog&tag=Astro"), {
		tags: ["Blog", "Astro"],
		categories: [],
		uncategorized: false,
	});
	assert.deepEqual(parseArchiveFilter("?category=General&category=Tech"), {
		tags: [],
		categories: ["General", "Tech"],
		uncategorized: false,
	});
	assert.deepEqual(parseArchiveFilter("?uncategorized=true"), {
		tags: [],
		categories: [],
		uncategorized: true,
	});
	assert.deepEqual(parseArchiveFilter("?uncategorized="), {
		tags: [],
		categories: [],
		uncategorized: false,
	});
	assert.deepEqual(
		parseArchiveFilter("?tag=%E6%8A%80%E8%A1%93&category=Blog"),
		{
			tags: ["技術"],
			categories: ["Blog"],
			uncategorized: false,
		},
	);
});

test("filterArchivePosts filters by tag, category, uncategorized, and combinations", () => {
	const slugs = (posts) => posts.map((post) => post.slug);

	assert.deepEqual(
		slugs(filterArchivePosts(SAMPLE_POSTS)),
		slugs(SAMPLE_POSTS),
	);
	assert.deepEqual(
		slugs(filterArchivePosts(SAMPLE_POSTS, parseArchiveFilter("?tag=Astro"))),
		["hello-world", "year-end-utc"],
	);
	assert.deepEqual(
		slugs(
			filterArchivePosts(
				SAMPLE_POSTS,
				parseArchiveFilter("?tag=Blog&tag=Notes"),
			),
		),
		["hello-world", "new-year-utc"],
	);
	assert.deepEqual(
		slugs(
			filterArchivePosts(SAMPLE_POSTS, parseArchiveFilter("?category=General")),
		),
		["hello-world"],
	);
	assert.deepEqual(
		slugs(
			filterArchivePosts(
				SAMPLE_POSTS,
				parseArchiveFilter("?uncategorized=true"),
			),
		),
		["new-year-utc", "uncategorized-null"],
	);
	assert.deepEqual(
		slugs(
			filterArchivePosts(
				SAMPLE_POSTS,
				parseArchiveFilter("?tag=Astro&category=Tech"),
			),
		),
		["year-end-utc"],
	);
	assert.deepEqual(
		slugs(
			filterArchivePosts(
				SAMPLE_POSTS,
				parseArchiveFilter("?category=General&uncategorized=true"),
			),
		),
		[],
	);
});

test("ArchivePanel.svelte compiles cleanly in Svelte 5 runes mode for SSR and client", () => {
	const source = readFileSync(ARCHIVE_PANEL_PATH, "utf8");
	for (const generate of ["server", "client"]) {
		const { warnings } = compile(source, {
			filename: "src/components/ArchivePanel.svelte",
			runes: true,
			generate,
		});
		assert.deepEqual(warnings, [], `${generate} compiler warnings`);
	}
});
