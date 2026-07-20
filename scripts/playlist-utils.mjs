/**
 * fetch-playlists.mjs の純粋ロジック部分。node --test (tests/unit/) から
 * 直接 import するため、ネットワークやファイル I/O を持たない。
 */

/**
 * --weekly 指定時は weekly: true のプレイリストだけを対象にする。
 * JSON の order フィールドは全体リスト内の位置で決まるため、
 * 絞り込み後も元の index を order として保持する。
 */
export function selectPlaylists(playlists, { weeklyOnly = false } = {}) {
	return playlists
		.map((playlist, order) => ({ playlist, order }))
		.filter(({ playlist }) => !weeklyOnly || playlist.weekly === true);
}

/**
 * fetchedAt だけが違う再取得結果を「変更なし」と判定する
 * (トラックが無変更の週に diff だけ生まれて PR が作られるのを防ぐ)。
 * キー順序が一致する前提の JSON 比較なので、スクリプトの出力構造を
 * 変えた直後は「変更あり」に倒れ、単に再書き込みされるだけで安全。
 */
export function isSamePlaylistContent(a, b) {
	if (!a || !b) {
		return false;
	}
	return (
		JSON.stringify({ ...a, fetchedAt: null }) ===
		JSON.stringify({ ...b, fetchedAt: null })
	);
}
