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

// 意図的にローカル改変しているファイル。.claude/skills/ からの相対パス。
// 差分検査はこれらの差分を想定どおりとして扱い、単体テストは冒頭の変更告知を要求する。
// 改変の内容は .claude/skills/README.md の「上流からの改変点」に記録している。
export const LOCALLY_MODIFIED = new Set([
	"wrangler/SKILL.md",
	"workers-best-practices/SKILL.md",
]);

// Apache-2.0 第 4 条 (b) は、改変したファイル自身に変更した旨の告知を載せることを求める。
// 改変したファイルの冒頭 (frontmatter があればその直後) に、この文字列で始まる引用ブロックを置く。
export const MODIFICATION_NOTICE = "**Modified by necofuryai:**";

// 差分検査が「上流に取り込み待ちの更新あり」を報告する終了コード。
// Node 自身の異常終了 (読み込み時のエラーを含む 1 など) や Bash の予約値と重ならない値にして、
// それ以外の非 0 はすべて「検査の失敗」と判定できるようにしている (skills-drift.yml の case が依存)。
export const EXIT_DRIFT = 20;
