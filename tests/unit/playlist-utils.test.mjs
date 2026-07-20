import assert from "node:assert/strict";
import { test } from "node:test";
import {
	isSamePlaylistContent,
	selectPlaylists,
} from "../../scripts/playlist-utils.mjs";

test("selectPlaylists returns every playlist with its position by default", () => {
	const list = [{ slug: "a", weekly: true }, { slug: "b" }];
	assert.deepEqual(selectPlaylists(list), [
		{ playlist: list[0], order: 0 },
		{ playlist: list[1], order: 1 },
	]);
});

test("selectPlaylists keeps original order indexes when filtering weekly", () => {
	// weekly が先頭以外にあっても order (= JSON に書かれる表示順) がずれないこと
	const list = [
		{ slug: "a" },
		{ slug: "b", weekly: true },
		{ slug: "c" },
		{ slug: "d", weekly: true },
	];
	assert.deepEqual(selectPlaylists(list, { weeklyOnly: true }), [
		{ playlist: list[1], order: 1 },
		{ playlist: list[3], order: 3 },
	]);
});

test("isSamePlaylistContent ignores fetchedAt-only differences", () => {
	const existing = {
		placeholder: false,
		order: 0,
		fetchedAt: "2026-07-20T21:48:45.409Z",
		id: "pl.rp-x",
		tracks: [{ id: "1", title: "Song" }],
	};
	const refetched = { ...existing, fetchedAt: "2026-07-27T21:48:00.000Z" };
	assert.equal(isSamePlaylistContent(existing, refetched), true);
});

test("isSamePlaylistContent detects real content changes", () => {
	const existing = {
		fetchedAt: "2026-07-20T21:48:45.409Z",
		tracks: [{ id: "1", title: "Song" }],
	};
	const refetched = {
		fetchedAt: "2026-07-27T21:48:00.000Z",
		tracks: [{ id: "2", title: "New Song" }],
	};
	assert.equal(isSamePlaylistContent(existing, refetched), false);
});

test("isSamePlaylistContent treats missing existing data as changed", () => {
	assert.equal(isSamePlaylistContent(null, { fetchedAt: "x" }), false);
});
