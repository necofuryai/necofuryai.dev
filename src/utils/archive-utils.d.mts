export interface ArchivePostData {
	tags?: readonly string[];
	category?: string | null;
	published: Date;
}

export interface ArchivePost {
	data: ArchivePostData;
}

export interface ArchiveFilter {
	tags: string[];
	categories: string[];
	uncategorized: boolean;
}

export interface ArchiveGroup<T extends ArchivePost = ArchivePost> {
	year: number;
	posts: T[];
}

/** Formats a post date as UTC `MM-DD` (matching src/utils/date-utils.ts) */
export function formatArchiveDate(date: Date): string;

/** Parses tag, category, and uncategorized filters from a URL search string */
export function parseArchiveFilter(search: string): ArchiveFilter;

/** Filters archive posts by tag, category, and uncategorized criteria */
export function filterArchivePosts<T extends ArchivePost>(
	posts: readonly T[],
	filter?: {
		tags?: readonly string[];
		categories?: readonly string[];
		uncategorized?: boolean;
	},
): T[];

/** Groups posts by UTC publication year in descending year order */
export function groupArchivePostsByYear<T extends ArchivePost>(
	posts: readonly T[],
): ArchiveGroup<T>[];
