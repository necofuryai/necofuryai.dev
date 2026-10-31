# Playlist page (`/playlists/`): data and operations

This is the detailed reference for the Apple Music playlist page, its data refresh, and its refresh PRs, moved out of `AGENTS.md`. The original design decision and later changes are in `docs/apple-music-playlist-publishing-research.md`.

## Implementation

The playlist page renders Apple Music playlists statically from build-time data. Its implementation lives in `src/pages/playlists.astro`, `src/components/AppleMusicPlaylist.astro`, and `src/components/AppleMusicTrackRow.astro`, the track row that carries the preview button.

The artwork in each track row acts as a 30-second preview button through `data-am-preview-url`. The player is the inline script in `src/pages/playlists.astro`: all tracks share one `<audio>` element mounted directly under `body` and protected by `data-am-preview-ready`. Stop playback on Swup's `content:replace` event because the body-level audio element survives content replacement.

## Data and `pnpm fetch-playlists`

Playlist data is committed under `src/data/playlists/*.json`. The `pnpm fetch-playlists` command runs `scripts/fetch-playlists.mjs` to refresh it through the official Apple Music API endpoint `GET /v1/catalog/{storefront}/playlists/{id}`. The request uses a developer token and does not require user sign-in.

The command requires Apple Developer Program credentials through the `APPLE_MUSIC_TEAM_ID`, `APPLE_MUSIC_KEY_ID`, and `APPLE_MUSIC_PRIVATE_KEY` environment variables; it may load them from `.env`. It creates a new ES256-signed developer token with a one-hour lifetime for each run and does not store or rotate a long-lived token.

`pnpm fetch-playlists` attempts to read `.env` when that file exists. Run it only when the user authorizes that exact file and purpose. If the user requests a refresh with credentials already exported but does not authorize `.env` access, run `node scripts/fetch-playlists.mjs` directly.

To keep builds deterministic, playlist fetching is not part of `pnpm build`. Refresh data manually or through `.github/workflows/refresh-playlists.yml`, which supports `workflow_dispatch` and runs every Monday because Replay updates on Sundays.

Scheduled runs pass `--weekly` and fetch only the two playlists that Apple updates: Replay All Time and the current year, marked with `weekly: true` in the `PLAYLISTS` array. If only `fetchedAt` changes, the script does not write the JSON and the workflow does not open a PR. Refresh every playlist through `scope=all` in `workflow_dispatch` or by running `pnpm fetch-playlists` manually.

A JSON file with `placeholder: true` contains placeholder data and causes the page to display a notice.

## Refresh PRs

Refresh PRs are created with the repository `GITHUB_TOKEN`, so their `pull_request` workflows wait for maintainer approval. When the user explicitly requests that approval, review Files changed, then use Merge status -> Awaiting approval -> Approve workflows to run; do not close and reopen the PR. When the PR is behind `main`, update it with `gh pr update-branch` instead of approving: the update is triggered by the user, so the required checks run without approval.

The workflow requests review from `necofuryai` when it creates a PR, but only best-effort: a failed request logs a `::warning` and the run still succeeds, so a refresh PR without a reviewer is not a defect. It refuses to create a duplicate while an earlier refresh PR is open. `.github/workflows/monitor-playlist-refresh.yml` records any refresh PR left open for more than 24 hours in a deduplicated Issue.

Data refresh PRs run the normal UI smoke tests. Track-list changes do not require image-file updates.

## Adding playlists and the new year

Add or reorder playlists in the script's `PLAYLISTS` array; the page renders `src/data/playlists/*.json` automatically in `order` sequence. The display follows a rolling window of Replay All Time, the current year, and the previous two years.

At the start of a new year, update the `PLAYLISTS` array and move the `weekly` marker to the new current-year playlist. Move the former current year into a historical slot and remove the oldest year.
