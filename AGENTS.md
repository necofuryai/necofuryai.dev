# AGENTS.md

Detailed references live in `docs/`; sections with one name the file and when to read it first.

## Non-negotiable guardrails

- **Commissioned artwork (こでびる, AI-terms ban):** The banner (`siteConfig.banner`) and avatar (`profileConfig.avatar`) are commissioned artwork whose terms forbid input into generative AI services.
  - Never Read, screenshot, attach, upload (`SendUserFile`, artifacts), or pass to any subagent, tool, or service the originals or anything derived from them: generated WebP files (`src/assets/images/witch-banner.webp`, `witch-avatar.webp`), the social image in `public/og/`, the favicons in `public/favicon/`, `dist/_astro/witch-*`, `dist/og/`, `dist/favicon/`, Astro's image cache (`node_modules/.astro/assets/witch-*`), other crops, Playwright artifacts, or pages rendered with them.
  - Never set `SITE_ASSETS_SOURCE` to `local` or `r2`.
  - Before `pnpm preview`, `pnpm test:ui`, or any browser inspection, run `pnpm build` yourself in the same session (placeholders by default); never reuse a `dist/` or server you did not start (the owner may have built with originals).
  - When real artwork matters, check numbers (hashes, dimensions, files) and ask the user to look.
- **`.env*` authorization gate:** Astro/Vite commands (`dev`, `check`, `build`, `preview`, `type-check`, `test:ui`) and `pnpm fetch-playlists` load live `.env*` files when present. Run them only when the user authorizes the exact environment file and purpose; otherwise run only non-Astro/Vite checks (unit tests, `biome ci`, diff checks) and report skipped checks. For a playlist refresh with credentials already exported (without `.env` access), run `node scripts/fetch-playlists.mjs` directly.
- **Production deployment:** Deploy production only through Workers Builds; never run local `pnpm build` + `wrangler deploy` (which ships placeholders).
- **External GitHub actions:** Approve playlist refresh PR workflows only on explicit request, and never close/reopen the PR. Never repair/push a Dependabot PR lockfile manually (an extra commit stops Dependabot rebasing); post `@dependabot recreate` as a human user only when explicitly authorized.

## Project overview

necofuryai's Japanese technical blog: a static Astro site based on [Fuwari](https://github.com/saicaca/fuwari) (`6d39b0d`), deployed with Cloudflare Workers Static Assets.

The commissioned banner and avatar illustrations are not in the repository and are outside all its licenses (see `Non-negotiable guardrails`). Repo licenses: source code is MIT (except `.claude/skills/`), `src/content/` is CC BY-NC-SA 4.0, and `.claude/skills/` (vendored Cloudflare skills plus local changes) is Apache-2.0 (`.claude/skills/LICENSE`). Before modifying a vendored file under `.claude/skills/`, or when `pnpm diff-skills` reports a modified file as `更新`, follow "上流への再同期" in `.claude/skills/README.md`; recording changes in 「上流からの改変点」 is checked only in review.

## Commands

- Use `pnpm` (`scripts/check-package-manager.js`). `pnpm-workspace.yaml` sets `pmOnFail: ignore` so GitHub's dependency graph can read the lockfile; pnpm will not auto-switch locally, so run the `packageManager` version yourself (CI installs it).
- Node.js `>=22.23.4` is required (`astro`'s CLI exits below it on Node 22). Read "Node.js floor" in `docs/dependencies.md` before changing `engines.node`, and raise it with the `astro` update that raises the CLI floor.
- Astro/Vite commands require `.env*` authorization (see `Non-negotiable guardrails`).

```sh
pnpm dev              # Prepare site assets ("Banner and avatar") and start dev at localhost:4321
pnpm build            # Prepare site assets, astro build, published-asset check, Pagefind index
pnpm preview          # Preview dist
pnpm check            # Run astro check
pnpm type-check       # Run astro sync and tsc --noEmit
pnpm test:unit        # Run node --test against tests/unit/*.test.mjs
pnpm test:ui          # Run Playwright UI smoke tests
pnpm new-post <slug>  # Create src/content/posts/<slug>.md from template
```

Pagefind indexes `dist` at build time, not `dev`; verify search with `pnpm build && pnpm preview`.

## Commit messages and pull requests

IMPORTANT: Write `git commit` messages and PR titles in English as `<type>: <description>` (`feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`), even when the session language is Japanese. Write PR bodies in Japanese. Because squash merge defaults to `COMMIT_OR_PR_TITLE`, both single-commit subjects and PR titles enter `main` history.

## UI smoke tests

- Live in `tests/ui/pages.spec.ts` (CI runs pinned desktop Chromium). Run `pnpm build` before `pnpm test:ui` (`webServer` starts `pnpm preview`); filter with `--grep <pattern>` (single project `desktop`, so `--project` narrows nothing).
- Assert semantically from DOM, geometry, and served files/responses — no pixel diffs or committed baseline images; preserve existing coverage.
- Add new routes to `cases` in `tests/ui/pages.spec.ts`, or add a test for non-HTML/error routes.
- Pre-release check 2 layout inspection needs no saved screenshots.

## Pre-release checks

Before declaring work complete or opening a PR, verify and report command outputs as evidence:

1. Pass `pnpm check`, `pnpm type-check`, `pnpm test:unit`, `node --test scripts/ci/*.test.mjs`, `pnpm build`, `pnpm test:ui`, and `pnpm exec biome ci .` — backing `main`'s local-command required checks (`CI OK`, `quality`; `main` also requires PR-level `Dependency Review` and `Dependabot Auto-merge Policy`). `pnpm lint` rewrites files and is not the CI command. CI also runs `pnpm peers check --lockfile-only` on `package.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml`.
2. For layout changes, inspect desktop, mobile, and dark modes and add semantic assertions to `tests/ui/` for functionally important behavior.
3. For feed changes, verify `dist/rss.xml` is valid XML and verify monetized-link disclosure via `tests/unit/rss-content.test.mjs` (and in `dist/rss.xml` whenever a non-draft `promotion: true` post is published; currently the only one is `draft: true`).
4. For layout/script changes, preserve GA4's `data-swup-ignore-script` guard and manual `page_view`, and ensure new inline scripts tolerate Swup re-execution.
5. Keep trailing slashes on internal links (`trailingSlash: "always"`) and exclude `draft: true` posts from production builds.

## Architecture

Stack: Astro 7, Svelte 5 (interactive islands only), Tailwind CSS 4 (`@tailwindcss/vite`), Biome 2.

### Svelte configuration

- Keep Svelte options inline in `svelte()` (`astro.config.mjs`) with `configFile: false` and top-level `dynamicCompileOptions` (forces runes mode; wrapping in `vitePlugin: {}` disables it, pinned by `tests/unit/astro-config-svelte.test.mjs`). Do not add `svelte.config.js`.
- Omit `preprocess` for `<script lang="ts">` and plain `<style>`; add `preprocess: [vitePreprocess()]` only if a `<style>` gains `lang`.

### Markdown pipeline (`astro.config.mjs`)

- Keep `markdown.processor` on `unified()`, not Astro 7's Rust processor: custom plugins in `src/plugins/` (admonitions, GitHub cards, excerpts, reading time, `rel="sponsored nofollow noopener"` for `SPONSORED_LINK_DOMAINS`) require it.
- Directives (`:::note`, `::github{repo="..."}`) use `remark-directive` and `rehype-components`. Always write GitHub cards as two-colon leaf directives (`::github{...}`): unclosed `:::github` containers are rejected by `GithubCardComponent` and swallow following blocks.
- `remark-math` + `rehype-katex` render math; Expressive Code renders code blocks with custom language-badge and copy-button plugins.
- RSS (`src/utils/rss-content.mjs`, `src/pages/rss.xml.ts`) uses a separate `markdown-it` + `sanitize-html` pipeline reimplementing admonitions, `SPONSORED_LINK_DOMAINS`, and `promotion: true` disclosure; keep both pipelines in sync when changing directives or monetized-link behavior.

### Content

- Leave `prevTitle`, `prevSlug`, `nextTitle`, `nextSlug` to `getSortedPosts()` (`content-utils.ts`).
- `draft: true` posts show in dev via `import.meta.env.PROD` in `src/utils/content-utils.ts`.
- Keep images (incl. covers) under `src/`: leading `/` serves raw files without WebP or `srcset`.

### Page language

- Default `<html lang>` is `siteConfig.lang` (`ja`); `/about/` sets `lang="en"` and posts use frontmatter `lang`. Keep `/about/` on Swup rather than full loads: the owner prefers Swup transitions despite Chrome only re-evaluating translation offers on full loads.
- Shared UI (navbar, sidebar, banner credit, footer) uses `i18n()` (`lang={uiLang}`). `MainGridLayout.astro` renders `<Footer>` twice: desktop (inside `<main>`) is replaced by Swup; mobile (outside `<main>`) persists across visits.
- Keep `force_language: "ja"` in `pagefind.yml` so `/about/` stays searchable from Japanese pages.
- Add a site-wide language toggle only alongside translated pages under `/en/`.

### Banner and avatar

Artwork bans in `Non-negotiable guardrails` apply here. Read `docs/site-assets.md` before you:

- edit `scripts/prepare-site-assets.mjs`, `scripts/site-assets.mjs` (including `og.crop`), `scripts/check-published-assets.mjs`, `ImageWrapper`, or the favicons
- edit `#banner-credit`/`#banner-wrapper` rules (`MainGridLayout.astro`, `Layout.astro`), banner constants (`BANNER_HEIGHT`, `BANNER_HEIGHT_EXTEND`, `MAIN_PANEL_OVERLAPS_BANNER_HEIGHT`, `banner.position`), or navbar height (`h-[4.5rem]` in `Navbar.astro`)
- replace the artwork, or touch the R2 bucket, its token, or Workers Builds build secrets

Cross-cutting rules outside those files:

- Only the two gitignored files `witch-banner.webp` and `witch-avatar.webp` may sit in `src/assets/images/` (`ImageWrapper`'s glob publishes every raster under `src/`).
- Keep the contractual text credit in the footer and `profileConfig.credit`: link only the artist's name to the artist's X profile and keep the label outside the link.

### Tailwind CSS 4 layers

Tailwind CSS 4 applies variants like `lg:` only to utilities/`@utility`, and utilities outrank `@layer components` regardless of specificity. Write breakpoint-sensitive or utility-overriding compound selectors as unlayered CSS with explicit `@media` (see `lg:is-home` in `src/layouts/Layout.astro`).

### Icons

- Astro files use `astro-icon` (build-time SVGs from `@iconify-json/*`; `icon({ include })` in `astro.config.mjs` narrows only named sets, leaving unlisted sets like `simple-icons` whole).
- Icon-rendering Svelte islands (currently the 3 in `Navbar.astro`, out of 4 total including `ArchivePanel.svelte`) use `@iconify/svelte` and must take build-time data from `resolveIconData()` (`src/utils/icon-data.mjs`) outside client code — never icon names or prop spreads on `Icon` (pinned by `tests/unit/island-icon-usage.test.mjs` and UI tests).
- Neither emits `.iconify`/`.iconify--*` here; never write CSS or test selectors using `.iconify`.

### Analytics (GA4)

- Emitted only in production builds with `PUBLIC_GA_MEASUREMENT_ID` (`src/layouts/Layout.astro`); fires manual `page_view` on `astro:page-load`, with GA4 enhanced-measurement history off.
- Swup dispatches `swup:${hook}` dynamically, so `node_modules` searches miss `swup:enable`; `Layout.astro`'s listeners are live.
- Update `src/content/spec/privacy.md` (`src/pages/privacy.astro`) on GA4 or tracker changes.

### Playlist page (`/playlists/`)

Renders Apple Music playlists statically from committed `src/data/playlists/*.json` (not fetched during `pnpm build`). Read `docs/playlists.md` at the start of a new year, and before you:

- run `pnpm fetch-playlists`/`scripts/fetch-playlists.mjs` or edit `PLAYLISTS` (also see `.env*` gate in `Non-negotiable guardrails`)
- edit `.github/workflows/{refresh-playlists,monitor-playlist-refresh}.yml`
- edit the preview player (`src/pages/playlists.astro` inline script, `AppleMusicTrackRow.astro`)
- act on a refresh PR

### Page transitions (Swup)

- `@swup/astro` replaces only `main` and `#toc`; the rest of `body` persists, so scripts cannot assume a single initial run or persistent container DOM.
- `reloadScripts: true` (default) re-executes page scripts on each navigation — including processed `<script>` tags inlined by `pnpm build` (never `pnpm dev`) when import-free and under 4 KiB (`build.assetsInlineLimit`). Guard `document` listeners with `data-*-ready` on `document.documentElement`, as `src/components/misc/Markdown.astro` (`data-copy-btn-ready`) does.

### Navbar

The navbar (`src/components/Navbar.astro`) persists across visits. Read `docs/navbar.md` before editing `Navbar.astro`, its float panels (`#nav-menu-panel`, `#search-panel`, `#display-setting`, `#light-dark-panel`), `Search.svelte`, `PagefindLoader`, or panel-closing handlers in `Layout.astro`, or before adding a nav link or lengthening the site title.

## Tooling and dependencies

### Biome

- Anchor every `files.includes` pattern to repo root (no `**/` prefix, which matches a worktree's path and makes Biome ignore all files in worktrees). Use `!!` force-ignores for build/checkout/scratch dirs (`dist`, `node_modules`, `playwright-report`, `test-results`, `.claude/.cc-writes`, `.claude/worktrees`, `tmp`) so nested `biome.json` files are skipped; keep `.astro` on `!` for generated types.
- Keep `markdown.formatter` and `yaml.formatter` off unless excluding `.claude/skills/`, `pnpm-lock.yaml`, and post frontmatter (Biome 2.6 formats both and adds a blank line after opening `---`).

### Dependencies

Read `docs/dependencies.md` before you:

- change `overrides` or `audit.ignore` in `pnpm-workspace.yaml`, or `engines.node` in `package.json`
- update packages (especially `overrides` keys or consumers like `katex`, `rehype-katex`, `remark-math`) or remove a dependency
- review or merge a Dependabot PR, or fix a transitive Dependabot alert by hand
- edit Dependabot/advisory workflows (`.github/workflows/{dependabot-automerge,dependabot-advisory-review,advisory-canary-fixture,dependency-review}.yml`, `.github/claude/advisory-permissions.json`)

Also read it if a Dependabot security update hits `dependency_file_not_resolvable`, all CI jobs on a Dependabot PR fail with `ERR_PNPM_BROKEN_LOCKFILE`, or a Dependabot PR bumps `@playwright/test`.
