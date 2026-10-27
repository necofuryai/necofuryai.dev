// Statuses are checked by hand against GitHub. Re-check every entry and update
// statusCheckedAt together, so the date on the page stays true for all of them.
// Dates are UTC calendar days (YYYY-MM-DD), as GitHub's timestamps give them.
export const statusCheckedAt = "2026-10-27";

export type ContributionStatus =
	| { state: "released"; version: string; url: string; date: string }
	| { state: "merged"; date: string; note: string }
	| { state: "in-review"; note: string }
	| { state: "awaiting-review"; note: string };

export interface OpenSourceContribution {
	project: string;
	repo: string;
	type: "Pull request" | "Bug report" | "Registry submission";
	number: number;
	title: string;
	url: string;
	opened: string;
	status: ContributionStatus;
	summary: string;
	related?: { label: string; url: string }[];
	// Only for entries whose upstream thread discloses AI assistance itself
	aiDisclosure?: string;
}

export const openSourceContributions = [
	{
		project: "Cloudflare Skills",
		repo: "cloudflare/skills",
		type: "Pull request",
		number: 220,
		title: "fix: point OpenTelemetry export links at the moved docs pages",
		url: "https://github.com/cloudflare/skills/pull/220",
		opened: "2026-10-07",
		status: {
			state: "merged",
			date: "2026-10-10",
			note: "The project publishes no tagged releases; the change is on the default branch, which its documented install commands use.",
		},
		summary:
			"After the Cloudflare docs moved the Workers OpenTelemetry export pages, ten links in the observability and Tail Workers references redirected to HTML instead of the Markdown pages that agents read. I repointed them to the new Markdown routes, also linked the Workers-specific setup page in the two places that need Wrangler settings the general page does not cover, and checked that all 748 distinct index.md URLs in the repository returned Markdown.",
		aiDisclosure:
			"AI-assisted (Claude Code), as disclosed in the pull request.",
	},
	{
		project: "Biome",
		repo: "biomejs/biome",
		type: "Pull request",
		number: 11876,
		title:
			"fix(biome_html_analyze): treat paired-tag components as content in useAnchorContent",
		url: "https://github.com/biomejs/biome/pull/11876",
		opened: "2026-09-21",
		status: {
			state: "in-review",
			note: "Open, not merged, and not in any release. I have updated it after each round of review, and it has been awaiting maintainer re-review since Oct 12, 2026.",
		},
		summary:
			"The HTML version of the useAnchorContent lint rule accepted a component as link content only when it was self-closing, so Astro, Vue, and Svelte code such as <a><Icon></Icon></a> was reported as an empty link. I reported the bug with a reproduction and the responsible code path (a maintainer confirmed it), then opened this fix. Following the maintainer's review, it applies the JSX rule's component check to paired tags, while Astro's Image still needs an accessible name, as in its self-closing form.",
		related: [
			{
				label: "Bug report #11872",
				url: "https://github.com/biomejs/biome/issues/11872",
			},
		],
		aiDisclosure:
			"The implementation, tests and snapshots, and changeset were written by Claude Code, as disclosed in the pull request.",
	},
	{
		project: "mise",
		repo: "jdx/mise",
		type: "Bug report",
		number: 13420,
		title:
			"npm backend: side-effects cache keeps absolute symlinks into the live install",
		url: "https://github.com/jdx/mise/discussions/13420",
		opened: "2026-09-20",
		status: {
			state: "released",
			version: "v2026.9.13",
			url: "https://github.com/jdx/mise/releases/tag/v2026.9.13",
			date: "2026-09-24",
		},
		summary:
			"I reported that a tool installed through mise's npm backend had lost its files, with a timeline of directory changes that placed the damage inside a window of mise cache activity. The maintainer traced it to cache pruning following symlinks out of the cache and fixed it. In a follow-up I found a second bug, where the setting documented to disable pruning did not stop a manual prune; it was fixed in the same pull request.",
		related: [
			{
				label: "Maintainer's fix #13424",
				url: "https://github.com/jdx/mise/pull/13424",
			},
		],
		aiDisclosure:
			"My follow-up reply is AI-assisted (Claude Code), as disclosed in the thread.",
	},
	{
		project: "Zed extensions",
		repo: "zed-industries/extensions",
		type: "Registry submission",
		number: 7091,
		title: "Add Genko Novel language support (grammar and LSP)",
		url: "https://github.com/zed-industries/extensions/pull/7091",
		opened: "2026-08-05",
		status: {
			state: "awaiting-review",
			note: "Open with no review yet, so Genko cannot be installed from Zed's extension registry.",
		},
		summary:
			"Submits Genko, my own Zed extension for Japanese fiction manuscripts, to Zed's official extension registry. Genko adds a Tree-sitter grammar for .genko files, covering headings, dialogue, explicit ruby, emphasis, and Aozora Bunko annotations, and a Rust language server that shows the body character count on hover.",
		related: [
			{
				label: "Source: necofuryai/genko-zed",
				url: "https://github.com/necofuryai/genko-zed",
			},
		],
	},
	{
		project: "Claude Code Action",
		repo: "anthropics/claude-code-action",
		type: "Pull request",
		number: 1580,
		title:
			"fix(cache): disable setup-bun cache to avoid 5-retry HTML-error burn",
		url: "https://github.com/anthropics/claude-code-action/pull/1580",
		opened: "2026-08-01",
		status: {
			state: "released",
			version: "v1.0.188",
			url: "https://github.com/anthropics/claude-code-action/releases/tag/v1.0.188",
			date: "2026-08-08",
		},
		summary:
			"The action's Bun setup saved its cache under a fixed key, so repeat runs on the same pull request spent 20–30 seconds retrying a rejected cache save. I rebased @MukundaKatta's existing fix from #1259 onto the current main, keeping them as the commit's author; it was squash-merged under my name, with them credited as co-author. I also added evidence of a second failure: in workflow_run jobs the cache is read-only, so the save failed on every run.",
		related: [
			{
				label: "Original fix #1259 by @MukundaKatta",
				url: "https://github.com/anthropics/claude-code-action/pull/1259",
			},
			{
				label: "Issue #1252",
				url: "https://github.com/anthropics/claude-code-action/issues/1252",
			},
		],
	},
] satisfies OpenSourceContribution[];
