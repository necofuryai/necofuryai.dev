# Banner and avatar: asset pipeline and operations

This is the detailed reference for the commissioned banner (`siteConfig.banner`) and avatar (`profileConfig.avatar`), moved out of `AGENTS.md`. The rules in the "Banner and avatar" section of `AGENTS.md` apply in full while you work from this file: never Read, screenshot, upload, or pass on the originals or anything made from them, and never set `SITE_ASSETS_SOURCE` to `local` or `r2`.

## Asset preparation (`scripts/prepare-site-assets.mjs`)

`scripts/prepare-site-assets.mjs` runs before `pnpm dev`, `pnpm start`, and `pnpm build`. It checks each original against the SHA-256 in `SITE_ASSETS` (`scripts/site-assets.mjs`), converts it to WebP, and writes the gitignored `src/assets/images/witch-banner.webp` and `witch-avatar.webp`. Only these two files may sit there: the image glob in `ImageWrapper` publishes every raster under `src/`.

From the same verified original, without a second download, the script crops the banner to `og.crop` in the banner's entry and writes the gitignored 1200x630 JPEG `public/og/witch-banner.jpg`, which Astro copies to `dist/og/` unchanged. `Layout.astro` uses it as the default `og:image` and `twitter:image`, with the size, type, and alt text from `DEFAULT_OG_IMAGE` in `src/utils/og-image.mjs`. It is a JPEG because LINE, Facebook, and Slack do not all show a WebP `og:image`. `og.crop` is in the original's pixels and must keep the exact 40:21 ratio of 1200x630; `tests/unit/site-assets.test.mjs` checks the ratio, the bounds, and that the path and size match `DEFAULT_OG_IMAGE`.

The same run resizes the avatar, uncropped, into the gitignored square PNG favicons listed in its `favicons` entry and writes them to `public/favicon/`, each at most `FAVICON_MAX_SIZE` (512 px), because a lossless PNG near the original's size would publish the original; `siteConfig.favicon` reads the same list from `AVATAR_FAVICONS` in `src/utils/favicon.mjs`, and the unit tests fail when the two drift apart. Nothing else belongs in `public/favicon/`: the template's favicons are gone, and the build fails on any other file there.

## Sources (`SITE_ASSETS_SOURCE`)

`SITE_ASSETS_SOURCE` selects where `scripts/prepare-site-assets.mjs` reads the originals from. `placeholder` is the default outside Workers Builds and writes same-size gradients, cropping the social image from a same-size gradient so CI catches a bad `og.crop`. `local` reads the originals from the gitignored `.site-assets/`; only the owner sets it, per command. `r2` downloads from the private R2 bucket `necofuryai-dev-site-assets` through the S3 API and saves the verified originals in `.site-assets/`. It needs `SITE_ASSETS_R2_ACCOUNT_ID`, `SITE_ASSETS_R2_ACCESS_KEY_ID`, and `SITE_ASSETS_R2_SECRET_ACCESS_KEY` (an R2 API token with Object Read only on that bucket). The account ID stays out of the repository like the token. The script reads these variables only from the process environment, never from `.env`.

## Workers Builds

On Workers Builds (`WORKERS_CI=1`), the production branch `main` must use `r2`, with the three `SITE_ASSETS_R2_*` values set as build secrets under Settings > Build > Variables and secrets. Every other branch is forced to `placeholder`, so the script never reads the credentials there. Workers Builds would still pass the build secrets to any branch build it runs, so keep non-production branch builds disabled, as they are now. `build.yml` also sets `SITE_ASSETS_SOURCE=placeholder`, because failed UI runs upload screenshots as public artifacts. Deploy production only through Workers Builds: a local `pnpm build` followed by `wrangler deploy` would ship the placeholders.

## Keeping the originals out of `dist`

`ImageWrapper` (`src/components/misc/ImageWrapper.astro`) reads only the width, height, and format of an imported image. Since astro 7.4, reading its `src` is the only access that marks the original as referenced, and Astro keeps a referenced original in `dist`, where Workers Static Assets would serve it; `<Image>` and `getImage()` read `src` without marking it.

`pnpm build` runs `scripts/check-published-assets.mjs` after `astro build` and fails if a `witch-*` original is in `dist/_astro`, or unless `dist/og/` holds only `witch-banner.jpg`, a 1200x630 JPEG identical to `public/og/witch-banner.jpg`, and `dist/favicon/` holds only the listed favicons, each a PNG of its declared size identical to its copy in `public/favicon/`, all different from every original and WebP. Keep images under `src/`: a path that starts with `/` serves the raw file without WebP conversion or a srcset.

## Banner credit placement (`#banner-credit`)

`#banner-credit` (`MainGridLayout.astro`) must stay off the face. On phones the face spans almost the whole width, so below `md` the credit is a 1.25rem text-only pill whose bottom sits 0.25rem above the cards, under the guide's face box (x 1100–2740, y 940–1260 of the 3840x2160 original, with `banner.position` `center`). Both the pill and the face scale with `vh`, so the viewport height, not the width, decides whether they meet; test on short phones such as 375x667.

An unlayered rule in `Layout.astro` hides the pill where it would come within 2px of the face box (below 596px tall under `md`) or no longer fits between the navbar and the cards (below 514.3px tall at `md` and wider). Recompute those thresholds when `BANNER_HEIGHT`, `BANNER_HEIGHT_EXTEND`, `MAIN_PANEL_OVERLAPS_BANNER_HEIGHT`, `banner.position`, the navbar height (`h-[4.5rem]` in `Navbar.astro`, the bottom edge the pill must clear at `md` and wider), or the pill's offsets change.

The footer and `profileConfig.credit` (a line under the bio) also credit the artist as text, which the artist was promised. Both link only the artist's name to the artist's X profile and keep the label (`banner.credit.label`, `profileConfig.credit.label`) outside the link; the pill links its whole text.

## Dark-mode fade (`#banner-wrapper`)

In dark mode at `md` and wider, `#banner-wrapper` fades its bottom `--banner-fade-length` into the page background with `mask-image`, so the light banner does not end in a hard line beside the cards. The length equals `MAIN_PANEL_OVERLAPS_BANNER_HEIGHT`, the strip below the cards' top edge, so nothing above the cards changes; a longer fade would darken the visible banner. Mask the wrapper, not `#banner`: on posts `#banner` is shifted by `bannerOffset`, and the visible edge is the wrapper's.

## Replacing the artwork or rotating the token

To replace the artwork, upload the new original under a new key with `wrangler r2 object put <bucket>/<key> --file <path> --content-type image/png --remote`, copy it to `.site-assets/<key>`, and update `key`, `sha256` (`shasum -a 256`), `width`, and `height` (`sips -g pixelWidth -g pixelHeight`) in `SITE_ASSETS`, and ask the owner to check `og.crop` against the new composition. Without `--remote`, wrangler writes to the local `.wrangler/` state instead. Keep the old object until no deployed commit refers to it.

The social image keeps its URL and platforms cache it by URL, so after the production build, have them fetch it again (for example with Facebook's Sharing Debugger). The favicons also keep their URLs, and `public/_headers` lets browsers reuse them for up to a week.

To rotate the token, create a new one with the same scope, replace the two key values in the Workers Builds build secrets, and revoke the old token after a production build succeeds.
