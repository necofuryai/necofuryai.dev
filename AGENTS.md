# AGENTS.md

This file provides guidance for coding agents working in this repository.

## Project overview

This repository contains necofuryai's Japanese-language technical blog. It is a static Astro site based on the [Fuwari](https://github.com/saicaca/fuwari) template at commit `6d39b0d` and is deployed with Cloudflare Workers Static Assets. The apex domain is served through the `custom_domain` setting in `wrangler.jsonc`.

The repository uses dual licensing: source code is licensed under MIT, while article content under `src/content/` is licensed under CC BY-NC-SA 4.0.

## Commands

Use pnpm. The `preinstall` hook in `scripts/check-package-manager.js` enforces it. Node.js 22.12.0 or later is required.

```sh
pnpm dev              # Start the development server at localhost:4321
pnpm build            # Run astro build and generate the Pagefind index
pnpm preview          # Preview the contents of dist
pnpm check            # Run astro check
pnpm type-check       # Run astro sync and tsc --noEmit
pnpm lint             # Run Biome checks with automatic fixes across the repository
pnpm format           # Run Biome formatting
pnpm new-post <slug>  # Create src/content/posts/<slug>.md from the post template
pnpm test:unit        # Run node --test against tests/unit/*.test.mjs
pnpm test:ui          # Run the Playwright UI smoke tests described below
pnpm diff-skills      # Compare vendored cloudflare/skills in .claude/skills/ with upstream
```

- Full-text search uses Pagefind to generate an index from the build output in `dist`, so it does not work on the development server. Verify search with `pnpm build && pnpm preview`.
- Before opening a PR, verify that `pnpm check` and `pnpm build` pass as required by `CONTRIBUTING.md`.

## Commit messages and pull requests

IMPORTANT: Write commit messages created with `git commit` and PR titles in English using the `<type>: <description>` format. Valid types are `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, and `ci`. This rule takes precedence even when the session language is Japanese. Write PR bodies in Japanese. A squash merge uses the PR title unchanged as the commit subject on `main`, so the title language becomes part of the repository history.

## UI smoke tests

- The tests live in `tests/ui/pages.spec.ts`. CI runs them against a pinned desktop Chromium configuration.
- Do not use pixel diffs or committed baseline images. Directly test every route's rendering, theme switching, the employment timeline on About, playlist expansion and collapse, focus restoration, the absence of iframes, and interactions after a Swup revisit.
- The Playwright `webServer` starts `pnpm preview`, so run `pnpm build` before the tests.
- Filter tests with `pnpm test:ui --grep <pattern>` or `pnpm test:ui --project=desktop`.
- After layout changes, inspect the rendered site locally in desktop, mobile, and dark modes. Saving screenshots and adding CI pixel diffs are not required.

## Pre-release checks

Before declaring the work complete or opening a PR, verify the following and report the command results as evidence:

1. `pnpm check`, `pnpm test:unit`, `pnpm build`, and `pnpm test:ui` pass. Search behavior can only be verified with `pnpm build && pnpm preview`.
2. For layout changes, inspect desktop, mobile, and dark modes and add semantic assertions to `tests/ui/` for behavior that is functionally important.
3. For changes that affect feeds, verify that `dist/rss.xml` is valid XML after the build and that the disclosure for monetized links remains in the article body.
4. For layout or script changes, preserve the GA4 guard based on `data-swup-ignore-script` and manual `page_view` events, and ensure that any new inline script tolerates Swup script re-execution.
5. Keep trailing slashes on internal links and keep posts with `draft: true` excluded from production builds.

## Architecture

The stack is Astro 7, Svelte 5 for interactive islands only, Tailwind CSS 4 through `@tailwindcss/vite`, Stylus for selected styles, and Biome 2.

### Markdown pipeline (`astro.config.mjs`)

The repository explicitly configures a `unified()`-based pipeline in `markdown.processor` instead of using Astro 7's default Rust processor. The custom remark and rehype plugins in `src/plugins/` implement admonitions, GitHub cards, excerpts, and reading time and are not compatible with the Rust processor. Do not remove the unified configuration.

- Directive syntax such as `:::note` and `:::github{repo="..."}` passes through remark-directive and `rehype-components` and is converted into components from `src/plugins/`.
- remark-math and rehype-katex render mathematics. Expressive Code renders code blocks with custom language-badge and copy-button plugins.

### Content

- `src/content/posts/` contains articles. The Zod schema is defined in `src/content.config.ts`. The `getSortedPosts()` function in `src/utils/content-utils.ts` injects the internal frontmatter fields `prevTitle`, `prevSlug`, `nextTitle`, and `nextSlug` at build time. Do not write these fields manually.
- Posts with `draft: true` are excluded only from production builds and remain visible in development through the `import.meta.env.PROD` branch in `content-utils.ts`.
- `src/content/spec/` contains fixed content such as the About page.
- Do not add a type annotation to `collections` in `content.config.ts`. Doing so removes schema inference and makes `entry.data` resolve to `unknown`; see the comment in that file.

### Site configuration

Site configuration is centralized in `src/config.ts` through `siteConfig`, `navBarConfig`, `profileConfig`, `licenseConfig`, and `expressiveCodeConfig`. Theme colors are stored as hue values from 0 through 360 and expanded into CSS variables. UI strings live in `src/i18n/`, and the site language is Japanese.

### Icons

The site uses two icon systems. Astro files use `astro-icon`, which embeds SVGs at build time from local `@iconify-json/*` packages; the allowed sets are configured through `icon({ include })` in `astro.config.mjs`. Svelte islands use `@iconify/svelte`, which retrieves icons at runtime from `api.iconify.design` and therefore creates third-party requests.

Neither system emits `iconify` or `iconify--*` classes. Do not write CSS or test selectors that depend on `.iconify`. Starting with `@iconify/svelte` v5, passing a `class` prop prevents the component's own class from being added, whereas v4 emitted both. This differs from the corresponding React and Vue packages and appears to be an upstream bug, but it has no functional effect because the omitted class is only a CSS hook and is never read by the package. If class merging returns in a future version, the additional class will be harmless.

### Analytics (GA4)

- **Output conditions:** `Layout.astro` emits the gtag snippet only for production builds that define `PUBLIC_GA_MEASUREMENT_ID`. The build validates that the measurement ID uses the `G-` format. Analytics are always disabled on the development server.
- **Manual page-view strategy:** The initial load relies on the automatic `page_view` from `gtag("config")`. For Swup SPA navigation, the site sends a manual `page_view` from the `astro:page-load` event so `page_title` is recorded correctly. Swup's `page:view` dispatches `astro:page-load` after the title has been updated. This event does not fire for the initial load.
- **Required GA4 property setting:** Disable the enhanced-measurement option for page changes based on browser history events. Enabling it causes duplicate SPA navigation events.
- **Script re-execution exclusion:** `@swup/astro` sets `reloadScripts` to `true` by default, so it clones and re-executes page scripts on each navigation. The GA tag uses `data-swup-ignore-script` and a re-execution guard to opt out.
- **Meaning of `swup:enable`:** Swup core bridges every hook to a DOM `CustomEvent` named `swup:<hook-name>`. `swup:enable` fires once during initialization, after page load during idle time and after assigning `window.swup`. The event name is constructed dynamically, so a string search through `node_modules` will not find it. Because it fires only once, analytics use `astro:page-load` for per-navigation events. `Layout.astro` still correctly relies on `swup:enable` to register Swup hooks that rebuild the banner height, table of contents, and PhotoSwipe. This behavior was verified with Playwright on 2026-07-19.
- The privacy policy is available at `/privacy/` and is implemented by `src/content/spec/privacy.md` and `src/pages/privacy.astro`.

### Playlist page (`/playlists/`)

The playlist page renders Apple Music playlists statically from build-time data. Its implementation lives in `src/pages/playlists.astro` and `src/components/AppleMusicPlaylist.astro`.

Playlist data is committed under `src/data/playlists/*.json`. The `pnpm fetch-playlists` command runs `scripts/fetch-playlists.mjs` to refresh it through the official Apple Music API endpoint `GET /v1/catalog/{storefront}/playlists/{id}`. The request uses a developer token and does not require user sign-in.

The command requires Apple Developer Program credentials through the `APPLE_MUSIC_TEAM_ID`, `APPLE_MUSIC_KEY_ID`, and `APPLE_MUSIC_PRIVATE_KEY` environment variables; it may load them from `.env`. It creates a new ES256-signed developer token with a one-hour lifetime for each run and does not store or rotate a long-lived token.

To keep builds deterministic, playlist fetching is not part of `pnpm build`. Refresh data manually or through `.github/workflows/refresh-playlists.yml`, which supports `workflow_dispatch` and runs every Monday because Replay updates on Sundays.

Scheduled runs pass `--weekly` and fetch only the two playlists that Apple updates: Replay All Time and the current year, marked with `weekly: true` in the `PLAYLISTS` array. If only `fetchedAt` changes, the script does not write the JSON and the workflow does not open a PR. Refresh every playlist through `scope=all` in `workflow_dispatch` or by running `pnpm fetch-playlists` manually.

At the start of a new year, update the `PLAYLISTS` array and move the `weekly` marker to the new current-year playlist. A JSON file with `placeholder: true` contains placeholder data and causes the page to display a notice.

The artwork in each track row acts as a 30-second preview button through `data-am-preview-url`. All tracks share one `<audio>` element mounted directly under `body` and protected by `data-am-preview-ready`. Stop playback on Swup's `content:replace` event because the body-level audio element survives content replacement.

Data refresh PRs run the normal UI smoke tests. Track-list changes do not require image-file updates. Add or reorder playlists in the script's `PLAYLISTS` array; the page renders `src/data/playlists/*.json` automatically in `order` sequence. The display follows a rolling window of Replay All Time, the current year, and the previous two years. At the start of a new year, move the former current year into a historical slot and remove the oldest year. See `docs/apple-music-playlist-publishing-research.md` for the original design decision and later changes.

### Page transitions (Swup)

`@swup/astro` provides SPA-like navigation by replacing only the `main` and `#toc` containers. Client-side scripts cannot assume that they run only once on the initial load; account for Swup revisits and content replacement.

Because `trailingSlash` is set to `"always"`, always include trailing slashes in internal links.

### Biome

- Biome applies to the entire repository and uses tabs and double quotes.
- `html.experimentalFullSupportEnabled: true` makes `.astro` and `.svelte` files formattable.
- `src/**/*.css` and Stylus files are excluded from Biome.
- CI also checks formatting and linting through `.github/workflows/biome.yml`.

### Dependencies

The `pnpm.overrides` entries in `package.json` pin transitive dependencies to address vulnerabilities and keep Dependabot alerts at zero. Do not remove them until patched versions have propagated through the upstream dependency graph.

The three overrides for `@swup/plugin@<4`, `minimatch@<10.2.2`, and `brace-expansion@<5.0.9` are a coordinated set rather than independent version pins. Together they remove the dependency path to the vulnerable version of `brace-expansion`; removing any one of them breaks the build.

An override key that carries a version selector, such as `brace-expansion@<5.0.9`, stops matching as soon as the pinned version is installed. When a later advisory widens its affected range, raise the selector and the target together rather than assuming the existing entry still covers it. The consumers keep declaring permissive ranges — `minimatch@10.2.6` still accepts `brace-expansion@^5.0.8`, and `cheerio@1.0.0` still accepts `undici@^6.19.5` — so these direct pins stay necessary even after the consumers are updated.

If every CI job on a Dependabot PR fails with `ERR_PNPM_BROKEN_LOCKFILE` and a duplicated mapping key, the cause is the GitHub test merge rather than the PR itself. An older PR and `main` have both added the same transitive dependency to the lockfile, and the textual merge produces the duplicate key. Confirm that the lockfile at the PR head is valid by using `git show origin/<branch>:pnpm-lock.yaml` and searching for the affected key, then post `@dependabot recreate` as a human user. Do not repair and push the lockfile manually: after an extra commit is pushed, Dependabot stops automatically rebasing that PR. Commands from a bot identity backed by `GITHUB_TOKEN` are rejected, so this operation cannot be automated that way.
