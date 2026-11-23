/*
 * Pure archive date formatting, query-string filter parsing, filtering, and
 * year-grouping helpers shared by ArchivePanel.svelte and the unit tests.
 *
 * Uses UTC calendar components (matching src/utils/date-utils.ts) so post
 * dates parsed as midnight UTC from frontmatter render the same month, day,
 * and year across server builds and visitor timezones without hydration drift.
 *
 * Kept free of imports so the unit tests can load it directly.
 */

/**
 * Formats a post date as UTC `MM-DD`.
 *
 * @param {Date} date
 * @returns {string}
 */
export function formatArchiveDate(date) {
	const month = String(date.getUTCMonth() + 1).padStart(2, "0");
	const day = String(date.getUTCDate()).padStart(2, "0");
	return `${month}-${day}`;
}

/**
 * Parses tag, category, and uncategorized filters from a URL search string.
 *
 * @param {string} search
 * @returns {{ tags: string[], categories: string[], uncategorized: boolean }}
 */
export function parseArchiveFilter(search) {
	const params = new URLSearchParams(search);
	return {
		tags: params.getAll("tag"),
		categories: params.getAll("category"),
		uncategorized: Boolean(params.get("uncategorized")),
	};
}

/**
 * Filters archive posts by tag, category, and uncategorized criteria.
 *
 * @template {{ data: { tags?: readonly string[], category?: string | null, published: Date } }} T
 * @param {readonly T[]} posts
 * @param {{ tags?: readonly string[], categories?: readonly string[], uncategorized?: boolean }} [filter]
 * @returns {T[]}
 */
export function filterArchivePosts(posts, filter = {}) {
	const { tags = [], categories = [], uncategorized = false } = filter;
	let filtered = [...posts];

	if (tags.length > 0) {
		filtered = filtered.filter(
			(post) =>
				Array.isArray(post.data.tags) &&
				post.data.tags.some((tag) => tags.includes(tag)),
		);
	}

	if (categories.length > 0) {
		filtered = filtered.filter(
			(post) =>
				Boolean(post.data.category) && categories.includes(post.data.category),
		);
	}

	if (uncategorized) {
		filtered = filtered.filter((post) => !post.data.category);
	}

	return filtered;
}

/**
 * Groups posts by UTC publication year, ordered newest year first while
 * preserving the relative order of posts within each year.
 *
 * @template {{ data: { published: Date } }} T
 * @param {readonly T[]} posts
 * @returns {Array<{ year: number, posts: T[] }>}
 */
export function groupArchivePostsByYear(posts) {
	const grouped = new Map();

	for (const post of posts) {
		const year = post.data.published.getUTCFullYear();
		let yearPosts = grouped.get(year);
		if (!yearPosts) {
			yearPosts = [];
			grouped.set(year, yearPosts);
		}
		yearPosts.push(post);
	}

	return Array.from(grouped, ([year, yearPosts]) => ({
		year,
		posts: yearPosts,
	})).sort((a, b) => b.year - a.year);
}
