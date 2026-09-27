/**
 * .claude/skills/ にベンダリングした cloudflare/skills (Apache-2.0) の定義。
 *
 * 次のファイルが共有する。差分検査は上流への通信と process.exit を伴い import できないため、
 * 共有する定義だけをこのファイルに置いている。
 * - scripts/diff-cloudflare-skills.mjs (上流との差分検査)
 * - tests/unit/vendored-skills-notice.test.mjs (変更告知の検査)
 * - tests/unit/diff-cloudflare-skills.test.mjs と tests/unit/fixtures/stub-fetch.mjs (差分検査の回帰テスト)
 * - tests/unit/skills-drift-workflow.test.mjs (ワークフローによる終了コードの分類の検査)
 */
import { createHash } from "node:crypto";

export const UPSTREAM =
	"https://raw.githubusercontent.com/cloudflare/skills/main";

// static-assets と observability は上流では包括スキル skills/cloudflare/ 側の参照資料。
// このリポジトリで実際に使う 2 領域だけを workers-best-practices の下へ移して同梱している。
const SHARED_REFERENCES = ["static-assets", "observability"];
const SHARED_REFERENCE_FILES = [
	"README",
	"api",
	"configuration",
	"gotchas",
	"patterns",
];

// [.claude/skills/ からの相対パス, 上流リポジトリのルートからの相対パス]
export const FILES = [
	// Apache-2.0 第 4 条 (a) によりライセンス本文を同梱している。上流で本文が変わったら気付けるよう検査する
	["LICENSE", "LICENSE"],
	["wrangler/SKILL.md", "skills/wrangler/SKILL.md"],
	["workers-best-practices/SKILL.md", "skills/workers-best-practices/SKILL.md"],
	...["configuration", "platform-apis", "runtime-patterns"].map((name) => [
		`workers-best-practices/references/${name}.md`,
		`skills/workers-best-practices/references/${name}.md`,
	]),
	...SHARED_REFERENCES.flatMap((area) =>
		SHARED_REFERENCE_FILES.map((name) => [
			`workers-best-practices/references/${area}/${name}.md`,
			`skills/cloudflare/references/${area}/${name}.md`,
		]),
	),
];

// 意図的にローカル改変しているファイル (.claude/skills/ からの相対パス) と、改変の元にした上流の版の
// git blob SHA。単体テストはこれらのファイルに冒頭の変更告知を要求する。
// 改変の内容は .claude/skills/README.md の「上流からの改変点」に記録している。
//
// 改変したファイルは上流と全文を比べると常に食い違うため、差分検査は現在の上流の blob SHA をこの値と比べ、
// 上流が改変の元にした版から変わっていれば要対応として報告する。
//
// 値と改変の元にする内容は、必ず同じ版から取る。値だけを後から取り直すと、その間に上流が進んでいた場合に、
// 取り込んでいない更新が「改変」に隠れる。
// - 新しく改変するとき: 先に pnpm diff-skills でそのファイルが「一致」であることを確かめ (「差分」なら先に
//   取り込む)、編集する前に git hash-object .claude/skills/<パス> で求める。
// - 取り込み直すとき: 差分検査が「更新」の行の -> の右側に出す値を使い、その版の内容を
//     gh api repos/cloudflare/skills/git/blobs/<SHA> -H "Accept: application/vnd.github.raw"
//   で取り出して改変を当て直す。左側 (記録済みの値) を渡せば旧版を取り出せるので、上流で何が変わったかを
//   旧版と新版の比較で確かめられる。
export const LOCALLY_MODIFIED = new Map([
	["wrangler/SKILL.md", "dcd985cc924db16ff7c3437741ab5dea9766aa88"],
	[
		"workers-best-practices/SKILL.md",
		"4b67f637255b42a11adb28826769f2b703d8730b",
	],
]);

// git と同じ方法で内容の blob SHA を求める (git hash-object や GitHub の API が返す値と一致する)。
// 文字列は UTF-8 のバイト列として扱う。長さは文字数ではなくバイト数で数える必要がある。
export function gitBlobSha(content) {
	const bytes = Buffer.from(content);
	return createHash("sha1")
		.update(`blob ${bytes.length}\0`)
		.update(bytes)
		.digest("hex");
}

// Apache-2.0 第 4 条 (b) は、改変したファイル自身に変更した旨の告知を載せることを求める。
// 改変したファイルの冒頭 (frontmatter があればその直後) に、この文字列で始まる引用ブロックを置く。
export const MODIFICATION_NOTICE = "**Modified by necofuryai:**";

// 差分検査が「上流に取り込み待ちの更新あり」を報告する終了コード。
// Node 自身の異常終了 (読み込み時のエラーを含む 1 など) や Bash の予約値と重ならない値にして、
// それ以外の非 0 はすべて「検査の失敗」と判定できるようにしている (skills-drift.yml の case が依存)。
export const EXIT_DRIFT = 20;
