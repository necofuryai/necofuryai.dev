import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { sep } from "node:path";
import { test } from "node:test";
import {
	LOCALLY_MODIFIED,
	MODIFICATION_NOTICE,
} from "../../scripts/cloudflare-skills-manifest.mjs";

// Apache-2.0 第 4 条 (b) の変更告知を検査する。上流との差分検査 (skills-drift.yml) は
// 通信を伴い必須チェックでもないため、通信の要らないこの検査は単体テストで常に走らせる。
const SKILLS_DIR = new URL("../../.claude/skills/", import.meta.url);

// frontmatter (先頭の --- で囲まれたブロック) があれば読み飛ばし、最初の空でない行を返す
function firstContentLine(text) {
	const lines = text.split(/\r?\n/);
	let start = 0;
	if (lines[0] === "---") {
		const end = lines.indexOf("---", 1);
		start = end === -1 ? lines.length : end + 1;
	}
	return lines.slice(start).find((line) => line.trim() !== "") ?? "";
}

// .claude/skills/ 以下の全ファイルを、LOCALLY_MODIFIED と同じ / 区切りの相対パスで返す
// (readdir の recursive は OS の区切り文字を使うため、Windows では \ になる)
async function listSkillFiles() {
	const names = await readdir(SKILLS_DIR, { recursive: true });
	return names.map((name) => name.split(sep).join("/"));
}

test("firstContentLine skips frontmatter and blank lines", () => {
	assert.equal(firstContentLine("---\nname: x\n---\n\n> a\nb"), "> a");
	assert.equal(firstContentLine("\n# Title\n"), "# Title");
});

test("locally modified vendored files start with the change notice", async () => {
	for (const name of LOCALLY_MODIFIED.keys()) {
		const text = await readFile(new URL(name, SKILLS_DIR), "utf8");
		assert.ok(
			firstContentLine(text).startsWith(`> ${MODIFICATION_NOTICE}`),
			`${name} の冒頭 (frontmatter の直後) に "> ${MODIFICATION_NOTICE}" で始まる変更告知がない。.claude/skills/README.md の「上流からの改変点」を参照`,
		);
	}
});

test("vendored SKILL.md files keep the frontmatter on the first line", async () => {
	// 告知を frontmatter より上に置くと firstContentLine の検査は通ってしまう。Claude Code は
	// 1 行目が --- のときだけ frontmatter を読むため、スキルは読み込まれるものの name は
	// ディレクトリ名、description は本文最初の行 (告知) になり、誤った説明で使うかどうかが判断される
	for (const name of await listSkillFiles()) {
		if (!name.endsWith("SKILL.md")) continue;
		const text = await readFile(new URL(name, SKILLS_DIR), "utf8");
		assert.equal(
			text.split(/\r?\n/)[0],
			"---",
			`${name} の 1 行目が frontmatter の開始 (---) ではない。このままでは name と description が読まれない。変更告知は frontmatter の直後に置く`,
		);
	}
});

test("vendored files carrying the change notice are registered as locally modified", async () => {
	for (const name of await listSkillFiles()) {
		// ルートの README.md は告知の書式を説明するために文字列を引用している
		if (!name.endsWith(".md") || name === "README.md") continue;
		const text = await readFile(new URL(name, SKILLS_DIR), "utf8");
		if (!text.includes(MODIFICATION_NOTICE)) continue;
		assert.ok(
			LOCALLY_MODIFIED.has(name),
			`${name} に変更告知があるが、scripts/cloudflare-skills-manifest.mjs の LOCALLY_MODIFIED に登録されていない`,
		);
	}
});
