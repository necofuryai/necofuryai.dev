# AGENTS.md

This file provides guidance for coding agents working in this repository.

## Project overview

This repository contains necofuryai's Japanese-language technical blog. It is a static Astro site based on the [Fuwari](https://github.com/saicaca/fuwari) template at commit `6d39b0d` and is deployed with Cloudflare Workers Static Assets. The apex domain is served through the `custom_domain` setting in `wrangler.jsonc`.

The banner and avatar illustrations are commissioned artwork that is not in the repository and is covered by none of its licenses; see "Banner and avatar". The repository uses three licenses: source code is licensed under MIT (except `.claude/skills/`), article content under `src/content/` under CC BY-NC-SA 4.0, and everything under `.claude/skills/` (Cloudflare skills vendored from cloudflare/skills, plus local changes) under Apache-2.0 (`.claude/skills/LICENSE`). When modifying a vendored file, first confirm that `pnpm diff-skills` shows it as `一致`, then register it in `LOCALLY_MODIFIED` in `scripts/cloudflare-skills-manifest.mjs` with its git blob SHA taken before editing (`git hash-object`), add or update the change notice right after the modified file's frontmatter (at its top if it has none), and record the change in `.claude/skills/README.md`. When the drift check reports a modified file as `更新`, re-apply the changes to the upstream version shown after `->` and record that same blob SHA; see "上流への再同期" in `.claude/skills/README.md`.

## Commands

Use pnpm. The `preinstall` hook in `scripts/check-package-manager.js` enforces it. Node.js 22.22.0 or later is required: on Node 22, astro 7.4's CLI exits with an error below 22.22.0, and `engines.node` records that floor. Some dependencies declare a higher minimum (`@astrojs/prism` 4.1.1 declares 22.23.4) without checking it at run time. pnpm 12.9.1 neither warns about nor rejects an `engines` mismatch by default, whether in this repository's field or a dependency's; only `engineStrict` makes it fail, on both alike. Raise `engines.node` together with the astro update that raises the CLI floor. `pnpm-workspace.yaml` sets `pmOnFail: ignore` to keep the lockfile readable by GitHub's dependency graph, so pnpm does not switch to the `packageManager` version by itself; run that version locally. CI installs it from `packageManager`.

Astro and Vite commands load live `.env*` files when present. Run `dev`, `check`, `build`, `preview`, `type-check`, or UI tests only when the user authorizes the exact environment file and purpose. Without authorization, limit validation to commands that do not invoke Astro/Vite, such as unit tests and diff checks, and report the skipped checks.

```sh
pnpm dev              # Prepare the banner, avatar, social image, and favicons, then start the development server at localhost:4321
pnpm build            # Prepare the banner, avatar, social image, and favicons, run astro build, and generate the Pagefind index
pnpm site-assets      # Only prepare the banner, avatar, social image, and favicons (see "Banner and avatar")
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

IMPORTANT: Write commit messages created with `git commit` and PR titles in English using the `<type>: <description>` format. Valid types are `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, and `ci`. This rule takes precedence even when the session language is Japanese. Write PR bodies in Japanese. The repository's squash default, `COMMIT_OR_PR_TITLE`, makes the commit subject on `main` the commit's title for a single-commit PR and the PR title otherwise, so both become part of the repository history.

## UI smoke tests

- The tests live in `tests/ui/pages.spec.ts`. CI runs them against a pinned desktop Chromium configuration.
- Do not use pixel diffs or committed baseline images. Directly test every route's rendering, theme switching, the employment timeline on About, playlist expansion and collapse, focus restoration, the absence of iframes, interactions after a Swup revisit, the default social image's meta tags and file, the favicons' link tags and files, the artist credits in the footer and the profile, and the banner credit's distance from the guide's face box, measured from DOM geometry.
- The Playwright `webServer` starts `pnpm preview`, so run `pnpm build` before the tests.
- Filter tests with `pnpm test:ui --grep <pattern>`. The config defines a single project, `desktop`, so `--project` narrows nothing.
- After layout changes, inspect the rendered site locally in desktop, mobile, and dark modes. Saving screenshots and adding CI pixel diffs are not required.

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

There is no `svelte.config.js`. The Svelte options live inline in the `svelte()` call in `astro.config.mjs` with `configFile: false`, which stops vite-plugin-svelte from probing for the file and logging `no Svelte config found at <root> - using default configuration.` on every Vite config resolution (`astro dev`, `build`, `sync`, and `check`). Keep `dynamicCompileOptions` at the top level of that options object: it forces runes mode for the site's own components, and wrapping it in `vitePlugin: {}` is accepted with only a warning (printed at plugin creation, so the build stays green) and silently disables the check; `tests/unit/astro-config-svelte.test.mjs` pins that shape so the mistake fails CI instead. There is no `preprocess` entry: the components use `<script lang="ts">`, which Svelte 5 compiles natively, and plain `<style>` blocks, so `vitePreprocess()` has nothing to do; add `preprocess: [vitePreprocess()]` back when a style block gains a `lang` attribute. Nothing else here reads a Svelte config file: `.vscode/extensions.json` does not recommend the Svelte extension, and `astro check` reports no diagnostics for `.svelte` files; it only converts them with svelte2tsx through `@astrojs/svelte/editor` to type their imports, and svelte2tsx reads no config.

### Markdown pipeline (`astro.config.mjs`)

The repository explicitly configures a `unified()`-based pipeline in `markdown.processor` instead of using Astro 7's default Rust processor. The custom remark and rehype plugins in `src/plugins/` implement admonitions, GitHub cards, excerpts, reading time, and the `rel="sponsored nofollow noopener"` attributes on links to `SPONSORED_LINK_DOMAINS`, and are not compatible with the Rust processor. Do not remove the unified configuration.

- Directive syntax such as `:::note` and `::github{repo="..."}` passes through remark-directive and `rehype-components` and is converted into components from `src/plugins/`. Write the GitHub card as a leaf directive with two colons: `GithubCardComponent` rejects a `:::github` container unless it is closed immediately, and an unclosed one swallows every block that follows it.
- remark-math and rehype-katex render mathematics. Expressive Code renders code blocks with custom language-badge and copy-button plugins.

### Content

- `src/content/posts/` contains articles. The Zod schema is defined in `src/content.config.ts`. The `getSortedPosts()` function in `src/utils/content-utils.ts` injects the internal frontmatter fields `prevTitle`, `prevSlug`, `nextTitle`, and `nextSlug` at build time. Do not write these fields manually.
- Posts with `draft: true` are excluded only from production builds and remain visible in development through the `import.meta.env.PROD` branch in `content-utils.ts`.
- `src/content/spec/` contains fixed content such as the About page.
- Do not add a type annotation to `collections` in `content.config.ts`. Doing so removes schema inference and makes `entry.data` resolve to `unknown`; see the comment in that file.

### Site configuration

Site configuration is centralized in `src/config.ts` through `siteConfig`, `navBarConfig`, `profileConfig`, `licenseConfig`, and `expressiveCodeConfig`. Theme colors are stored as hue values from 0 through 360 and expanded into CSS variables. UI strings live in `src/i18n/`, and the site language is Japanese.

### Banner and avatar

IMPORTANT: The banner (`siteConfig.banner`) and the avatar (`profileConfig.avatar`) are commissioned artwork by こでびる, whose terms forbid inputting it into generative AI services. Agents must never Read, screenshot, attach, upload (SendUserFile, artifacts), or pass to a subagent or any other tool or service the originals or anything made from them: the generated WebP files, the social image in `public/og/`, the favicons in `public/favicon/`, `dist/_astro/witch-*`, `dist/og/`, and `dist/favicon/`, Astro's image cache `node_modules/.astro/assets/witch-*`, other crops, Playwright artifacts, and pages rendered with them. Agents must never set `SITE_ASSETS_SOURCE` to `local` or `r2`. Before `pnpm preview`, `pnpm test:ui`, or any browser inspection, run `pnpm build` yourself in the same session, which uses placeholders by default. Never reuse a `dist/` or a server you did not start, because the owner may have built it with the originals. When the real artwork matters, check numbers (hashes, dimensions, file lists) and ask the user to look.

- `scripts/prepare-site-assets.mjs` runs before `pnpm dev`, `pnpm start`, and `pnpm build`. It checks each original against the SHA-256 in `SITE_ASSETS` (`scripts/site-assets.mjs`), converts it to WebP, and writes the gitignored `src/assets/images/witch-banner.webp` and `witch-avatar.webp`. Only these two files may sit there: the image glob in `ImageWrapper` publishes every raster under `src/`. From the same verified original, without a second download, it crops the banner to `og.crop` in the banner's entry and writes the gitignored 1200x630 JPEG `public/og/witch-banner.jpg`, which Astro copies to `dist/og/` unchanged. `Layout.astro` uses it as the default `og:image` and `twitter:image`, with the size, type, and alt text from `DEFAULT_OG_IMAGE` in `src/utils/og-image.mjs`. It is a JPEG because LINE, Facebook, and Slack do not all show a WebP `og:image`. `og.crop` is in the original's pixels and must keep the exact 40:21 ratio of 1200x630; `tests/unit/site-assets.test.mjs` checks the ratio, the bounds, and that the path and size match `DEFAULT_OG_IMAGE`. The same run resizes the avatar, uncropped, into the gitignored square PNG favicons listed in its `favicons` entry and writes them to `public/favicon/`, each at most `FAVICON_MAX_SIZE` (512 px), because a lossless PNG near the original's size would publish the original; `siteConfig.favicon` reads the same list from `AVATAR_FAVICONS` in `src/utils/favicon.mjs`, and the unit tests fail when the two drift apart. Nothing else belongs in `public/favicon/`: the template's favicons are gone, and the build fails on any other file there.
- `SITE_ASSETS_SOURCE` selects the source. `placeholder` is the default outside Workers Builds and writes same-size gradients, cropping the social image from a same-size gradient so CI catches a bad `og.crop`. `local` reads the originals from the gitignored `.site-assets/`; only the owner sets it, per command. `r2` downloads from the private R2 bucket `necofuryai-dev-site-assets` through the S3 API and saves the verified originals in `.site-assets/`. It needs `SITE_ASSETS_R2_ACCOUNT_ID`, `SITE_ASSETS_R2_ACCESS_KEY_ID`, and `SITE_ASSETS_R2_SECRET_ACCESS_KEY` (an R2 API token with Object Read only on that bucket). The account ID stays out of the repository like the token. The script reads these variables only from the process environment, never from `.env`.
- On Workers Builds (`WORKERS_CI=1`), the production branch `main` must use `r2`, with the three values set as build secrets under Settings > Build > Variables and secrets. Every other branch is forced to `placeholder`, so this script never reads the credentials there. Workers Builds would still pass the build secrets to any branch build it runs, so keep non-production branch builds disabled, as they are now. `build.yml` also sets `SITE_ASSETS_SOURCE=placeholder`, because failed UI runs upload screenshots as public artifacts. Deploy production only through Workers Builds: a local `pnpm build` followed by `wrangler deploy` would ship the placeholders.
- `ImageWrapper` reads only the width, height, and format of an imported image. Since astro 7.4, reading its `src` is the only access that marks the original as referenced, and Astro keeps a referenced original in `dist`, where Workers Static Assets would serve it; `<Image>` and `getImage()` read `src` without marking it. `pnpm build` runs `scripts/check-published-assets.mjs` after `astro build` and fails if a `witch-*` original is in `dist/_astro`, or unless `dist/og/` holds only `witch-banner.jpg`, a 1200x630 JPEG identical to `public/og/witch-banner.jpg`, and `dist/favicon/` holds only the listed favicons, each a PNG of its declared size identical to its copy in `public/favicon/`, all different from every original and WebP. Keep images under `src/`: a path that starts with `/` serves the raw file without WebP conversion or a srcset.
- `#banner-credit` (`MainGridLayout.astro`) must stay off the face. On phones the face spans almost the whole width, so below `md` the credit is a 1.25rem text-only pill whose bottom sits 0.25rem above the cards, under the guide's face box (x 1100–2740, y 940–1260 of the 3840x2160 original, with `banner.position` `center`). Both the pill and the face scale with `vh`, so the viewport height, not the width, decides whether they meet; test on short phones such as 375x667. An unlayered rule in `Layout.astro` hides the pill where it would come within 2px of the face box (below 596px tall under `md`) or no longer fits between the navbar and the cards (below 514.3px tall at `md` and wider). Recompute those thresholds when `BANNER_HEIGHT`, `BANNER_HEIGHT_EXTEND`, `MAIN_PANEL_OVERLAPS_BANNER_HEIGHT`, `banner.position`, or the pill's offsets change. The footer and `profileConfig.credit` (a line under the bio) also credit the artist as text, which the artist was promised. Both link only the artist's name to the artist's X profile and keep the label (`banner.credit.label`, `profileConfig.credit.label`) outside the link; the pill links its whole text.
- In dark mode at `md` and wider, `#banner-wrapper` fades its bottom `--banner-fade-length` into the page background with `mask-image`, so the light banner does not end in a hard line beside the cards. The length equals `MAIN_PANEL_OVERLAPS_BANNER_HEIGHT`, the strip below the cards' top edge, so nothing above the cards changes; a longer fade would darken the visible banner. Mask the wrapper, not `#banner`: on posts `#banner` is shifted by `bannerOffset`, and the visible edge is the wrapper's.
- To replace the artwork, upload the new original under a new key with `wrangler r2 object put <bucket>/<key> --file <path> --content-type image/png --remote`, copy it to `.site-assets/<key>`, and update `key`, `sha256` (`shasum -a 256`), `width`, and `height` (`sips -g pixelWidth -g pixelHeight`) in `SITE_ASSETS`, and ask the owner to check `og.crop` against the new composition. The social image keeps its URL and platforms cache it by URL, so after the production build, have them fetch it again (for example with Facebook's Sharing Debugger). The favicons also keep their URLs, and `public/_headers` lets browsers reuse them for up to a week. Without `--remote`, wrangler writes to the local `.wrangler/` state instead. Keep the old object until no deployed commit refers to it. To rotate the token, create a new one with the same scope, replace the two key values in the Workers Builds build secrets, and revoke the old token after a production build succeeds.

### Tailwind CSS 4 layers

Tailwind CSS 4 applies variants such as `lg:` only to its own utilities and `@utility` classes, and its utilities layer outranks `@layer components` regardless of selector specificity. Write a compound selector that must react to a breakpoint or override a utility as unlayered CSS with an explicit `@media`, as the `lg:is-home` banner rules in `src/layouts/Layout.astro` do.

### Icons

The site uses two icon systems. Astro files use `astro-icon`, which embeds SVGs at build time from local `@iconify-json/*` packages; every such package listed in `package.json` is loaded, and the `include` map in `icon({ include })` in `astro.config.mjs` only narrows the icons kept for the sets it names, so a set absent from it (`simple-icons`, rendered by `Profile.astro`) is still available whole. Svelte islands use `@iconify/svelte`, which retrieves icons at runtime from `api.iconify.design` and therefore creates third-party requests.

Neither system emits `iconify` or `iconify--*` classes: `@iconify/svelte` omits them whenever a `class` prop is passed, as the islands do, and the omitted class is only a CSS hook that nothing reads. Do not write CSS or test selectors that depend on `.iconify`.

### Analytics (GA4)

- **Output conditions:** `Layout.astro` emits the gtag snippet only for production builds that define `PUBLIC_GA_MEASUREMENT_ID`. The build validates that the measurement ID uses the `G-` format. Analytics are always disabled on the development server.
- **Manual page-view strategy:** The initial load relies on the automatic `page_view` from `gtag("config")`. For Swup SPA navigation, the site sends a manual `page_view` from the `astro:page-load` event so `page_title` is recorded correctly. Swup's `page:view` dispatches `astro:page-load` after the title has been updated. This event does not fire for the initial load.
- **Required GA4 property setting:** Disable the enhanced-measurement option for page changes based on browser history events. Enabling it causes duplicate SPA navigation events.
- **Script re-execution exclusion:** `@swup/astro` sets `reloadScripts` to `true` by default, so it clones and re-executes page scripts on each navigation. The GA tag uses `data-swup-ignore-script` and a re-execution guard to opt out.
- **Meaning of `swup:enable`:** Swup core bridges every hook to a DOM `CustomEvent` named `swup:<hook-name>`. `swup:enable` fires once during initialization, after page load during idle time and after assigning `window.swup`. The event name is constructed dynamically, so a string search through `node_modules` will not find it. Because it fires only once, analytics use `astro:page-load` for per-navigation events. `Layout.astro` still correctly relies on `swup:enable` to register Swup hooks that switch the banner-height body class, hide the table of contents during a transition, re-initialise the custom scrollbar, and re-create PhotoSwipe. This behavior was verified with Playwright on 2026-07-19.
- The privacy policy is available at `/privacy/` and is implemented by `src/content/spec/privacy.md` and `src/pages/privacy.astro`.

### Playlist page (`/playlists/`)

The playlist page renders Apple Music playlists statically from build-time data. Its implementation lives in `src/pages/playlists.astro`, `src/components/AppleMusicPlaylist.astro`, and `src/components/AppleMusicTrackRow.astro`, the track row that carries the preview button.

Playlist data is committed under `src/data/playlists/*.json`. The `pnpm fetch-playlists` command runs `scripts/fetch-playlists.mjs` to refresh it through the official Apple Music API endpoint `GET /v1/catalog/{storefront}/playlists/{id}`. The request uses a developer token and does not require user sign-in.

The command requires Apple Developer Program credentials through the `APPLE_MUSIC_TEAM_ID`, `APPLE_MUSIC_KEY_ID`, and `APPLE_MUSIC_PRIVATE_KEY` environment variables; it may load them from `.env`. It creates a new ES256-signed developer token with a one-hour lifetime for each run and does not store or rotate a long-lived token.

`pnpm fetch-playlists` attempts to read `.env` when that file exists. Run it only when the user authorizes that exact file and purpose. If the user requests a refresh with credentials already exported but does not authorize `.env` access, run `node scripts/fetch-playlists.mjs` directly.

To keep builds deterministic, playlist fetching is not part of `pnpm build`. Refresh data manually or through `.github/workflows/refresh-playlists.yml`, which supports `workflow_dispatch` and runs every Monday because Replay updates on Sundays.

Scheduled runs pass `--weekly` and fetch only the two playlists that Apple updates: Replay All Time and the current year, marked with `weekly: true` in the `PLAYLISTS` array. If only `fetchedAt` changes, the script does not write the JSON and the workflow does not open a PR. Refresh every playlist through `scope=all` in `workflow_dispatch` or by running `pnpm fetch-playlists` manually.

Refresh PRs are created with the repository `GITHUB_TOKEN`, so their `pull_request` workflows wait for maintainer approval. When the user explicitly requests that approval, review Files changed, then use Merge status -> Awaiting approval -> Approve workflows to run; do not close and reopen the PR. When the PR is behind `main`, update it with `gh pr update-branch` instead of approving: the update is triggered by the user, so the required checks run without approval. The workflow requests review from `necofuryai` when it creates a PR, but only best-effort: a failed request logs a `::warning` and the run still succeeds, so a refresh PR without a reviewer is not a defect. It refuses to create a duplicate while an earlier refresh PR is open. `.github/workflows/monitor-playlist-refresh.yml` records any refresh PR left open for more than 24 hours in a deduplicated Issue.

At the start of a new year, update the `PLAYLISTS` array and move the `weekly` marker to the new current-year playlist. A JSON file with `placeholder: true` contains placeholder data and causes the page to display a notice.

The artwork in each track row acts as a 30-second preview button through `data-am-preview-url`. All tracks share one `<audio>` element mounted directly under `body` and protected by `data-am-preview-ready`. Stop playback on Swup's `content:replace` event because the body-level audio element survives content replacement.

Data refresh PRs run the normal UI smoke tests. Track-list changes do not require image-file updates. Add or reorder playlists in the script's `PLAYLISTS` array; the page renders `src/data/playlists/*.json` automatically in `order` sequence. The display follows a rolling window of Replay All Time, the current year, and the previous two years. At the start of a new year, move the former current year into a historical slot and remove the oldest year. See `docs/apple-music-playlist-publishing-research.md` for the original design decision and later changes.

### Page transitions (Swup)

`@swup/astro` provides SPA-like navigation by replacing only the `main` and `#toc` containers. Client-side scripts cannot assume that they run only once on the initial load; account for Swup revisits and content replacement.

Because `trailingSlash` is set to `"always"`, always include trailing slashes in internal links.

### Biome

- Biome applies to the entire repository and uses tabs and double quotes.
- `html.experimentalFullSupportEnabled: true` makes `.astro` and `.svelte` files formattable.
- `src/**/*.css` is excluded from Biome.
- Every pattern in `files.includes` is anchored to the repository root (no `**/` prefix). `!!` force-ignores build output, nested checkouts, and local scratch (`dist`, `node_modules`, `playwright-report`, `test-results`, `.claude/.cc-writes`, `.claude/worktrees`, `tmp`), so the scanner never indexes them and a worktree's own `biome.json` is not reported as a nested root configuration; `.astro` keeps a plain `!` because it supplies generated types. Keep the patterns anchored: with a `**/` prefix they also match the worktree's own path, and Biome then ignores every file when it runs inside a worktree.
- CI also checks formatting and linting through `.github/workflows/biome.yml`.

### Dependencies

The `overrides` entries in `pnpm-workspace.yaml` pin transitive dependencies to address vulnerabilities and keep Dependabot alerts at zero. Do not remove them until patched versions have propagated through the upstream dependency graph. pnpm applies overrides to peer ranges too: `postcss@<8.5.23` makes the lockfile record `postcss: ^8.5.23` as the peer range of `postcss-nested`, which declares `^8.2.14`. Remove such a pin before moving to another major of the pinned package, which the rewritten peer ranges would not accept.

The `@swup/plugin@<4` override prunes a dependency path rather than pinning a patched version. `@swup/parallel-plugin` and `@swup/route-name-plugin` still declare `@swup/plugin@^3.0.0`, and version 3 lists its build toolchain (microbundle, prettier, and shelljs) as runtime dependencies, so forcing version 4 keeps that toolchain out of the tree.

The `katex@<0.18.2` override also forces a version outside the consumers' declared range. `rehype-katex` and `micromark-extension-math`, which `remark-math` pulls in, still declare `katex@^0.16.0`, and no 0.16 release contains the fix for GHSA-238p-pmpm-9mq7. The override moves them to the same 0.19 line as the direct `katex` dependency, which supplies `katex/dist/katex.css`, so the HTML rendered at build time and the stylesheet come from one version. KaTeX 0.18 renamed layout classes such as `base` and `strut` to `katex-base` and `katex-strut`, so 0.16 markup does not match the 0.18 stylesheet. Remove the override once both consumers accept a patched version.

The `postcss-selector-parser@<7.1.6` override likewise forces a version outside a consumer's declared range, across a major version. `@tailwindcss/typography` pins `postcss-selector-parser@6.0.10` exactly, while only 7.1.6 fixes GHSA-rj75-hqrm-r3gf. The other consumer, `postcss-nested@7`, which `@expressive-code/core` pulls in, declares `^7.0.0`, so for it the entry is only a lower-bound pin. Both consumers run only at build time on the site's own CSS, and the override leaves `dist` byte-identical. Verify any change to this override the same way: build before and after with `.astro`, `node_modules/.astro`, and `node_modules/.vite` removed, and compare `dist`. Once `@tailwindcss/typography` declares a 7.x range, the entry becomes an ordinary lower-bound pin.

pnpm matches an override key that carries a version selector, such as `"fast-uri@>=3.0.0 <X": "^X"`, against the range each consumer declares (a semver intersection test), never against the installed version, so the key keeps matching `ajv@8.20.0`'s `fast-uri@^3.0.1` after X is installed. What keeps the pin from moving is the lockfile: the locked X already satisfies the target `^X`, and pnpm re-resolves an override only when its entry changes. When a later advisory widens its affected range, raise the target, and the selector with it so the key still documents the advisory's range: the changed target is what makes `pnpm install` re-resolve the dependency and exclude the old version. The consumers keep declaring permissive ranges — `ajv@8.20.0` still accepts `fast-uri@^3.0.1` — so these direct pins stay necessary even after the consumers are updated.

Dependabot often cannot fix an alert on such a transitive dependency. pnpm 12 refuses its version-pinned `pnpm update <package>@<version> --lockfile-only` for a package that is not a direct dependency, and Dependabot then retries without a version. That retry resolves the newest release, while Dependabot asks for the newest release outside the `cooldown` in `.github/dependabot.yml`, so the run ends in `dependency_file_not_resolvable` whenever the newest release is younger than the cooldown (three days for a patch release). Under pnpm 11 the version-pinned form left the pin unchanged and ended in `security_update_not_possible`; see `docs/dependency-update-investigation.md`. Fix such an alert by hand. Run `pnpm update <package> --lockfile-only --config.minimum-release-age=4320` without a version, which moves the pin within the consumers' ranges to the newest release at least three days old, matching that cooldown. Then raise the matching override, or add one in the same shape when the package has none, run `pnpm install` with the same `--config.minimum-release-age` so the re-resolution keeps that release and the lockfile records the override, and confirm that `pnpm audit` exits 0 and reports nothing beyond the entries in `audit.ignore`.

`audit.ignore` in `pnpm-workspace.yaml` holds GHSA-ch52-4w7c-c8xp in `http-cache-semantics`, which only `astro` uses. Its Dependabot alert is dismissed as not used for the same reason: Astro calls only `storable()` and `timeToLive()` while caching remote images at build time, and the maintainer disputes the report, so no release fixes it. `astro` 7.4.0 moved it to 4.3.0, so `pnpm audit` no longer lists the advisory. Treat that move as an ordinary update rather than a fix, and keep the entry, because that version falls outside the advisory's range only because the range was written before 4.3.0 existed. `pnpm audit` does not warn about stale entries, and `pnpm audit --fix` prunes them only when `audit.ignorePrune: true` is set in `pnpm-workspace.yaml` (pnpm 12.0.0 or later, off by default; verified with pnpm 12.9.1), so remove the entry by hand once the advisory is withdrawn or a release fixes it. Edit `audit.ignore` by hand: on pnpm 12.9.1, `pnpm audit --ignore` appends the ID to an existing `audit.ignore` list but re-renders that block, dropping the comments inside it and the blank line after it, while the rest of the file is preserved; pnpm 11.20.0 wrote the ID into the deprecated `auditConfig` block instead. The explanatory comment therefore sits above the `audit:` key, where the writer leaves it.

Once pnpm has resolved one of Vite's optional peers, such as `sass`, `stylus`, or `terser`, the lockfile keeps it after nothing depends on it. `pnpm install`, `pnpm update`, `pnpm dedupe`, `--fix-lockfile`, and `"-"` removal overrides all leave it installed. To drop one, delete both `pnpm-lock.yaml` and `node_modules` before running `pnpm install`, because pnpm otherwise reuses `node_modules/.pnpm/lock.yaml`, and confirm with `pnpm why <package>` that it is gone.

If every CI job on a Dependabot PR fails with `ERR_PNPM_BROKEN_LOCKFILE` and a duplicated mapping key, the cause is the GitHub test merge rather than the PR itself. An older PR and `main` have both added the same transitive dependency to the lockfile, and the textual merge produces the duplicate key. Confirm that the lockfile at the PR head is valid by using `git show origin/<branch>:pnpm-lock.yaml` and searching for the affected key. If the user explicitly authorizes the external comment, post `@dependabot recreate` as a human user. Do not repair and push the lockfile manually: after an extra commit is pushed, Dependabot stops automatically rebasing that PR. Commands from a bot identity backed by `GITHUB_TOKEN` are rejected, so this operation cannot be automated that way.
