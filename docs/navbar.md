# Navbar and its float panels

This is the detailed reference for the navbar (`src/components/Navbar.astro`), its float panels, and the search islands, moved out of `AGENTS.md`.

## Layout

The nav links and the desktop search field both switch at `lg`; below it, the menu button and the search toggle replace them. At 1024px the row has about 20px to spare while the search field is focused (`focus:w-48`, `xl:focus:w-60`), so make room before adding a link or lengthening the site title. Below 360px the site title drops its home icon, so the row fits at 320px, the width WCAG 1.4.10 asks content to reflow at.

The navbar's height (`h-[4.5rem]`) also sets where `#banner-credit` is hidden at `md` and wider. Before changing it, read "Banner credit placement" in `docs/site-assets.md` and recompute the thresholds there.

## Opening and closing the float panels

The float panels (`#nav-menu-panel`, `#search-panel`, `#display-setting`, `#light-dark-panel`) open and close by toggling `.float-panel-closed`. It hides a panel with `visibility` as well as opacity, because opacity and `pointer-events` alone leave its links and inputs in the Tab order. Tailwind 4's `transition` does not include `visibility`, so a panel that should fade out when it closes needs `transition-all`. A panel transitions with the `transition-property` of its new state. `#light-dark-panel` opens when focus enters its switch, so it carries `transition-all` only while closed and `transition` while open. Its visibility therefore flips at once when it opens: if visibility were transitioned there too, it would stay hidden for the first frame, and an immediate Tab would skip the theme buttons.

## Closing the panels on navigation

The navbar sits outside the Swup containers and persists across visits, and `setClickOutsideToClose` ignores clicks inside a panel. `Layout.astro` therefore closes the panels when a link inside one is clicked, which also covers a link to the current page (Swup only scrolls) and a link that opens a new tab, and again on Swup's `visit:start` for back and forward. If focus is inside the panel (after keyboard selection, and in Chromium after a mouse click too), the click handler first returns focus to the panel's switch, because a hidden link would otherwise keep the focus. Svelte state (`panelOpen`) drives `#light-dark-panel`; never toggle its class from outside.

## Search (`Search.svelte`, `PagefindLoader`)

`PagefindLoader` (`src/components/misc/PagefindLoader.astro`) carries `data-swup-ignore-script`: when `reloadScripts` re-ran it on each visit, `pagefindready` fired again, and `Search.svelte` searched for the keyword left in the field and reopened the closed panel. As a result, a failed Pagefind load now lasts until a full reload. For the same reason, `Search.svelte` drops a search still pending when a visit starts.
