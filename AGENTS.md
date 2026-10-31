# AGENTS.md

Detailed references for some areas live in `docs/`; the sections that have one name the file and the tasks that require reading it first.

## Project overview

This repository contains necofuryai's Japanese-language technical blog. It is a static Astro site based on the [Fuwari](https://github.com/saicaca/fuwari) template at commit `6d39b0d` and is deployed with Cloudflare Workers Static Assets.

The banner and avatar illustrations are commissioned artwork that is not in the repository and is covered by none of its licenses; see "Banner and avatar". The repository uses three licenses: source code is licensed under MIT (except `.claude/skills/`), article content under `src/content/` under CC BY-NC-SA 4.0, and everything under `.claude/skills/` (Cloudflare skills vendored from cloudflare/skills, plus local changes) under Apache-2.0 (`.claude/skills/LICENSE`). Before modifying a vendored file under `.claude/skills/`, and when `pnpm diff-skills` reports a modified file as `更新`, follow "上流への再同期" in `.claude/skills/README.md`. It covers confirming `一致` first, registering the file in `LOCALLY_MODIFIED` in `scripts/cloudflare-skills-manifest.mjs` (with the git blob SHA taken before editing for a new modification, or the upstream SHA shown after `->` for `更新`), the change notice, and the record in 「上流からの改変点」, which only review checks.

## Commands

Use pnpm. The `preinstall` hook in `scripts/check-package-manager.js` enforces it. Node.js 22.22.0 or later is required: on Node 22, astro 7.4's CLI exits with an error below 22.22.0, and `engines.node` records that floor. Read "Node.js floor" in `docs/dependencies.md` before changing `engines.node`, and raise it together with the astro update that raises the CLI floor. `pnpm-workspace.yaml` sets `pmOnFail: ignore` to keep the lockfile readable by GitHub's dependency graph, so pnpm does not switch to the `packageManager` version by itself; run that version locally. CI installs it from `packageManager`.

Astro and Vite commands load live `.env*` files when present. Run `dev`, `check`, `build`, `preview`, `type-check`, or UI tests only when the user authorizes the exact environment file and purpose. Without authorization, limit validation to commands that do not invoke Astro/Vite, such as unit tests and diff checks, and report the skipped checks.

```sh
pnpm dev              # Prepare the site assets (see "Banner and avatar"), then start the development server at localhost:4321
pnpm build            # Prepare the site assets, run astro build and the published-asset check, and generate the Pagefind index
pnpm preview          # Preview the contents of dist
pnpm check            # Run astro check
pnpm type-check       # Run astro sync and tsc --noEmit
pnpm test:unit        # Run node --test against tests/unit/*.test.mjs
pnpm test:ui          # Run the Playwright UI smoke tests described below
pnpm new-post <slug>  # Create src/content/posts/<slug>.md from the post template
```

Full-text search uses Pagefind to generate an index from the build output in `dist`, so it does not work on the development server. Verify search with `pnpm build && pnpm preview`.

## Commit messages and pull requests

IMPORTANT: Write commit messages created with `git commit` and PR titles in English using the `<type>: <description>` format. Valid types are `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, and `ci`. This rule takes precedence even when the session language is Japanese. Write PR bodies in Japanese. The repository's squash default, `COMMIT_OR_PR_TITLE`, makes the commit subject on `main` the commit's title for a single-commit PR and the PR title otherwise, so both become part of the repository history.

## UI smoke tests

- The tests live in `tests/ui/pages.spec.ts`. CI runs them against a pinned desktop Chromium configuration.
- Assert behavior semantically, from the DOM, its geometry, and the served files and responses; do not use pixel diffs or committed baseline images. Keep the coverage the spec already has when you change it.
- Every route has a render test: add a new page route to `cases` in `tests/ui/pages.spec.ts`, or give a non-HTML or error route its own test.
- The Playwright `webServer` starts `pnpm preview`, so run `pnpm build` before the tests.
- Filter tests with `pnpm test:ui --grep <pattern>`. The config defines a single project, `desktop`, so `--project` narrows nothing.
- The layout inspection in Pre-release check 2 needs no saved screenshots.

## Pre-release checks

Before declaring the work complete or opening a PR, verify the following and report the command results as evidence:

1. `pnpm check`, `pnpm type-check`, `pnpm test:unit`, `node --test scripts/ci/*.test.mjs`, `pnpm build`, `pnpm test:ui`, and `pnpm exec biome ci .` pass; these are the commands behind the required `CI OK` and `quality` status checks on `main`. `pnpm lint` rewrites files and is not the CI command. CI also runs `pnpm peers check --lockfile-only` against a copy of `package.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml`. Search behavior can only be verified with `pnpm build && pnpm preview`.
2. For layout changes, inspect desktop, mobile, and dark modes and add semantic assertions to `tests/ui/` for behavior that is functionally important.
3. For changes that affect feeds, verify that `dist/rss.xml` is valid XML after the build and that the disclosure for monetized links remains in the article body.
4. For layout or script changes, preserve the GA4 guard based on `data-swup-ignore-script` and manual `page_view` events, and ensure that any new inline script tolerates Swup script re-execution.
5. Keep trailing slashes on internal links and keep posts with `draft: true` excluded from production builds.

## Architecture

The stack is Astro 7, Svelte 5 for interactive islands only, Tailwind CSS 4 through `@tailwindcss/vite`, and Biome 2.

### Svelte configuration

There is no `svelte.config.js`. The Svelte options live inline in the `svelte()` call in `astro.config.mjs` with `configFile: false`, which stops vite-plugin-svelte from probing for the file and logging `no Svelte config found at <root> - using default configuration.` on every Vite config resolution. Keep `dynamicCompileOptions` at the top level of that options object: it forces runes mode for the site's own components, and wrapping it in `vitePlugin: {}` silently disables the check; `tests/unit/astro-config-svelte.test.mjs` pins that shape so the mistake fails CI instead. There is no `preprocess` entry: the components use `<script lang="ts">`, which Svelte 5 compiles natively, and plain `<style>` blocks; add `preprocess: [vitePreprocess()]` back when a style block gains a `lang` attribute. Nothing else here reads a Svelte config file: `astro check` reports no diagnostics for `.svelte` files and only converts them with svelte2tsx, which reads no config.

### Markdown pipeline (`astro.config.mjs`)

The repository explicitly configures a `unified()`-based pipeline in `markdown.processor` instead of using Astro 7's default Rust processor. The custom remark and rehype plugins in `src/plugins/` implement admonitions, GitHub cards, excerpts, reading time, and the `rel="sponsored nofollow noopener"` attributes on links to `SPONSORED_LINK_DOMAINS`, and are not compatible with the Rust processor. Keep `markdown.processor` on the unified pipeline.

- Directive syntax such as `:::note` and `::github{repo="..."}` passes through remark-directive and `rehype-components` and is converted into components from `src/plugins/`. Write the GitHub card as a leaf directive with two colons: `GithubCardComponent` rejects a `:::github` container unless it is closed immediately, and an unclosed one swallows every block that follows it.
- remark-math and rehype-katex render mathematics. Expressive Code renders code blocks with custom language-badge and copy-button plugins.

### Content

- The `getSortedPosts()` function in `src/utils/content-utils.ts` injects the internal frontmatter fields `prevTitle`, `prevSlug`, `nextTitle`, and `nextSlug` at build time. Leave them to `getSortedPosts()`.
- Posts with `draft: true` are excluded only from production builds and remain visible in development through the `import.meta.env.PROD` branch in `content-utils.ts`.
- Keep images, including post cover images, under `src/`: a path that starts with `/` serves the raw file without WebP conversion or a srcset.
- Let Astro infer the type of `collections` in `src/content.config.ts`: a type annotation removes schema inference and makes `entry.data` resolve to `unknown`; see the comment in that file.

### Page language

- `siteConfig.lang` (`ja`) is the default `<html lang>`. `/about/` is written in English and passes `lang="en"` to `MainGridLayout`, as posts pass their frontmatter `lang`. Swup's head plugin copies `<html lang>` on each navigation.
- `i18n()` always returns `siteConfig.lang` strings, so the navbar, sidebar, banner credit, and footer carry `lang={uiLang}` on every page, whatever the page's own `lang`: all but the footer sit outside the Swup containers and persist across visits.
- Pagefind builds one index per `<html lang>` and searches only the index of the page it starts on. `force_language: "ja"` in `pagefind.yml` keeps `/about/` in the single index; without it, About drops out of searches on Japanese pages.
- Google detects a page's language from its visible text and ignores `lang` and `hreflang` for that. The attributes serve screen readers, CJK glyph selection, and browser translation offers. Add a site-wide language toggle only together with translated pages behind it; translations would get their own URLs under `/en/`.

### Banner and avatar

IMPORTANT: The banner (`siteConfig.banner`) and the avatar (`profileConfig.avatar`) are commissioned artwork by こでびる, whose terms forbid inputting it into generative AI services. Agents must never Read, screenshot, attach, upload (SendUserFile, artifacts), or pass to a subagent or any other tool or service the originals or anything made from them: the generated WebP files, the social image in `public/og/`, the favicons in `public/favicon/`, `dist/_astro/witch-*`, `dist/og/`, and `dist/favicon/`, Astro's image cache `node_modules/.astro/assets/witch-*`, other crops, Playwright artifacts, and pages rendered with them. Agents must never set `SITE_ASSETS_SOURCE` to `local` or `r2`. Before `pnpm preview`, `pnpm test:ui`, or any browser inspection, run `pnpm build` yourself in the same session, which uses placeholders by default. Never reuse a `dist/` or a server you did not start, because the owner may have built it with the originals. When the real artwork matters, check numbers (hashes, dimensions, file lists) and ask the user to look.

Read `docs/site-assets.md` before you:

- edit `scripts/prepare-site-assets.mjs`, `scripts/site-assets.mjs` (including `og.crop`), `scripts/check-published-assets.mjs`, `ImageWrapper`, or the favicons
- edit the `#banner-credit` or `#banner-wrapper` rules in `MainGridLayout.astro` and `Layout.astro`, the banner constants (`BANNER_HEIGHT`, `BANNER_HEIGHT_EXTEND`, `MAIN_PANEL_OVERLAPS_BANNER_HEIGHT`, `banner.position`), or the navbar height (`h-[4.5rem]` in `Navbar.astro`)
- replace the artwork, or touch the R2 bucket, its token, or the Workers Builds build secrets

These rules apply everywhere:

- `scripts/prepare-site-assets.mjs` writes the gitignored `src/assets/images/witch-banner.webp` and `witch-avatar.webp`. Only these two files may sit there: the image glob in `ImageWrapper` publishes every raster under `src/`. Nothing but the favicons listed in the avatar's `favicons` entry in `SITE_ASSETS` (mirrored by `AVATAR_FAVICONS` in `src/utils/favicon.mjs`) belongs in `public/favicon/`, and the build fails on any other file there.
- `ImageWrapper` reads only the width, height, and format of an imported image. Reading its `src` marks the original as referenced, and Astro keeps a referenced original in `dist`, where Workers Static Assets would serve it.
- On Workers Builds, the production branch `main` must use `r2`, and the script reads its credentials only from the process environment, never from `.env`. Workers Builds would pass the build secrets to any branch build it runs, so keep non-production branch builds disabled. Deploy production only through Workers Builds: a local `pnpm build` followed by `wrangler deploy` would ship the placeholders.
- `#banner-credit` (`MainGridLayout.astro`), the credit pill, must stay off the guide's face. Recompute the thresholds in `docs/site-assets.md` when the banner constants, the navbar height, or the pill's offsets change.
- The footer and `profileConfig.credit` also credit the artist as text, which the artist was promised. Both link only the artist's name to the artist's X profile and keep the label outside the link.

### Tailwind CSS 4 layers

Tailwind CSS 4 applies variants such as `lg:` only to its own utilities and `@utility` classes, and its utilities layer outranks `@layer components` regardless of selector specificity. Write a compound selector that must react to a breakpoint or override a utility as unlayered CSS with an explicit `@media`, as the `lg:is-home` banner rules in `src/layouts/Layout.astro` do.

### Icons

The site uses two icon systems. Astro files use `astro-icon`, which embeds SVGs at build time from local `@iconify-json/*` packages; every such package listed in `package.json` is loaded, and the `include` map in `icon({ include })` in `astro.config.mjs` only narrows the icons kept for the sets it names, so a set absent from it (`simple-icons`, rendered by `Profile.astro`) is still available whole. Svelte islands use `@iconify/svelte`, which retrieves icons at runtime from `api.iconify.design` and therefore creates third-party requests.

Neither system emits `iconify` or `iconify--*` classes: `@iconify/svelte` omits them whenever a `class` prop is passed, as the islands do, and the omitted class is only a CSS hook that nothing reads. Do not write CSS or test selectors that depend on `.iconify`.

### Analytics (GA4)

The comments on the GA4 tag in `src/layouts/Layout.astro` describe how it is emitted and counted: only in production builds that define `PUBLIC_GA_MEASUREMENT_ID`, with a manual `page_view` from `astro:page-load` on each Swup visit, and with the GA4 property's enhanced-measurement option for history-based page changes kept off so visits are not counted twice. Swup bridges every hook to a DOM `CustomEvent` whose name it builds at run time as `swup:${hook}`, so a string search through `node_modules` will not find where `swup:enable` is dispatched; the `swup:enable` listeners in `Layout.astro` are live. A change to what the tag sends, or a new tracker, also changes the privacy policy in `src/content/spec/privacy.md` (rendered by `src/pages/privacy.astro`), which describes what is sent to Google.

### Playlist page (`/playlists/`)

The playlist page renders Apple Music playlists statically from build-time data committed under `src/data/playlists/*.json`; to keep builds deterministic, playlist fetching is not part of `pnpm build`. Read `docs/playlists.md` at the start of a new year, and before you:

- run `pnpm fetch-playlists` or `scripts/fetch-playlists.mjs`, or edit its `PLAYLISTS` array
- edit the refresh workflows (`.github/workflows/refresh-playlists.yml`, `.github/workflows/monitor-playlist-refresh.yml`)
- edit the preview player (the inline script in `src/pages/playlists.astro`, the button in `AppleMusicTrackRow.astro`)
- act on a refresh PR

These rules apply everywhere:

- `pnpm fetch-playlists` attempts to read `.env` when that file exists. Run it only when the user authorizes that exact file and purpose. If the user requests a refresh with credentials already exported but does not authorize `.env` access, run `node scripts/fetch-playlists.mjs` directly.
- Approve the workflows of a refresh PR only when the user explicitly requests that approval, and do not close and reopen the PR.
- All tracks share one `<audio>` element directly under `body`, where it persists across visits; stop playback on Swup's `content:replace` event.

### Page transitions (Swup)

On each visit, `@swup/astro` replaces only the Swup containers, `main` and `#toc`; the rest of the body persists across visits. Client-side scripts cannot assume that they run only once on the initial load: account for Swup revisits and content replacement, since the elements in the containers are new after each visit. `@swup/astro` also sets `reloadScripts` to `true` by default, so it clones and re-executes page scripts on each navigation, and scripts must tolerate Swup script re-execution. That includes a processed `<script>` once `pnpm build` (never `pnpm dev`) inlines it, which it does when the script has no imports and is under `build.assetsInlineLimit` (4 KiB by default), so a script that adds a listener to `document` guards the registration with a `data-*-ready` marker on `document.documentElement`, as the scripts in `src/pages/playlists.astro` do. The GA tag uses `data-swup-ignore-script` and a re-execution guard to opt out.

Because `trailingSlash` is set to `"always"`, always include trailing slashes in internal links.

### Navbar

The navbar (`src/components/Navbar.astro`) persists across visits. Read `docs/navbar.md` before editing `Navbar.astro`, its float panels (`#nav-menu-panel`, `#search-panel`, `#display-setting`, `#light-dark-panel`), the search components (`Search.svelte`, `PagefindLoader`), or the panel-closing handlers in `Layout.astro`, and before adding a nav link or lengthening the site title. These rules apply everywhere:

- `.float-panel-closed` hides a panel with `visibility` as well as opacity. Tailwind 4's `transition` does not include `visibility`, so a panel that should fade out when it closes needs `transition-all`.
- Open and close `#light-dark-panel` only through its Svelte state (`panelOpen` in `LightDarkSwitch.svelte`).

### Biome

- Every pattern in `files.includes` is anchored to the repository root (no `**/` prefix). `!!` force-ignores build output, nested checkouts, and local scratch (`dist`, `node_modules`, `playwright-report`, `test-results`, `.claude/.cc-writes`, `.claude/worktrees`, `tmp`), so the scanner never indexes them and a worktree's own `biome.json` is not reported as a nested root configuration; `.astro` keeps a plain `!` because it supplies generated types. Keep the patterns anchored: with a `**/` prefix they also match the worktree's own path, and Biome then ignores every file when it runs inside a worktree.
- `markdown.formatter` and `yaml.formatter` are disabled. Biome 2.6 formats both by default, which would rewrite the vendored files under `.claude/skills/` away from upstream, reformat the pnpm-generated `pnpm-lock.yaml`, and insert a blank line after the opening `---` of post frontmatter. Enable either only together with excludes for those files.

### Dependencies

Read `docs/dependencies.md` before you:

- change `overrides` or `audit.ignore` in `pnpm-workspace.yaml`, or `engines.node` in `package.json`
- update a package that an `overrides` key names, or one of its consumers (for example `katex`, `rehype-katex`, or `remark-math`)
- review or merge a Dependabot PR
- fix a Dependabot alert on a transitive dependency by hand
- remove a dependency

Read it also when a Dependabot security update fails with `dependency_file_not_resolvable`, or every CI job on a Dependabot PR fails with `ERR_PNPM_BROKEN_LOCKFILE`.

These rules apply everywhere:

- The `overrides` entries in `pnpm-workspace.yaml` pin transitive dependencies to address vulnerabilities and keep Dependabot alerts at zero. Keep each pin until patched versions have propagated through the upstream dependency graph. pnpm applies overrides to peer ranges too, so remove a pin that rewrote a consumer's peer range (`postcss@<8.5.23` is one) before moving that package to another major. An override that forces consumers past their declared range (`katex`, `postcss-selector-parser`) stays at least until the consumers accept a patched version, and the `katex` one is raised together with the direct `katex` dependency.
- `audit.ignore` holds GHSA-gcqx-w48m-w2h4 in `deepmerge`, which no release fixes. Do not override it with a patched fork. Edit `audit.ignore` by hand: `pnpm audit --ignore` re-renders that block and drops the comments inside it.
- Do not repair and push the lockfile of a Dependabot PR manually: after an extra commit is pushed, Dependabot stops automatically rebasing that PR. Post `@dependabot recreate` as a human user only if the user explicitly authorizes the external comment.
