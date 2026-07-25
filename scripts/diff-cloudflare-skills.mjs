#!/usr/bin/env node
/**
 * .claude/skills/ にベンダリングした cloudflare/skills (Apache-2.0) の
 * 上流との差分を確認する。
 *
 * 実行: pnpm diff-skills / pnpm diff-skills --diff (差分本文も表示)
 *
 * これらのスキルはプラグイン経由ではなく手動コピーで導入しているため、
 * 上流の更新は自動では降ってこない。更新を取り込むかどうかを判断するために使う。
 *
 * 意図的にローカル改変しているファイル (LOCALLY_MODIFIED) は差分が出て当然なので
 * 終了コードには影響させない。改変の内容は .claude/skills/README.md の
 * 「上流からの改変点」に記録している。
 *
 * 終了コード (.github/workflows/skills-drift.yml がこの区別に依存している):
 * - 0: 対応不要 (完全一致、またはローカル改変のみ)
 * - 1: 要対応 (上流が更新された、またはファイルが欠落している)
 * - 2: 検査自体が失敗した (上流の取得エラーなど)。1 と取り違えると誤報になるため分けている
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const UPSTREAM = "https://raw.githubusercontent.com/cloudflare/skills/main";
const SKILLS_DIR = new URL("../.claude/skills/", import.meta.url);

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

const FILES = [
	["wrangler/SKILL.md", "skills/wrangler/SKILL.md"],
	["workers-best-practices/SKILL.md", "skills/workers-best-practices/SKILL.md"],
	[
		"workers-best-practices/references/rules.md",
		"skills/workers-best-practices/references/rules.md",
	],
	[
		"workers-best-practices/references/review.md",
		"skills/workers-best-practices/references/review.md",
	],
	...SHARED_REFERENCES.flatMap((area) =>
		SHARED_REFERENCE_FILES.map((name) => [
			`workers-best-practices/references/${area}/${name}.md`,
			`skills/cloudflare/references/${area}/${name}.md`,
		]),
	),
];

// 差分が出て当然のファイル (README.md の「上流からの改変点」を参照)
const LOCALLY_MODIFIED = new Set([
	"wrangler/SKILL.md",
	"workers-best-practices/SKILL.md",
]);

const showDiff = process.argv.includes("--diff");

async function fetchUpstream(path) {
	const response = await fetch(`${UPSTREAM}/${path}`);
	if (!response.ok) {
		throw new Error(`${response.status} ${response.statusText}: ${path}`);
	}
	return response.text();
}

async function readLocal(path) {
	try {
		return await readFile(new URL(path, SKILLS_DIR), "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}

async function printDiff(workDir, name, upstream, local) {
	const upstreamPath = join(workDir, "upstream.md");
	const localPath = join(workDir, "local.md");
	await writeFile(upstreamPath, upstream);
	await writeFile(localPath, local);
	try {
		execFileSync(
			"diff",
			[
				"-u",
				"--label",
				`upstream/${name}`,
				upstreamPath,
				"--label",
				`local/${name}`,
				localPath,
			],
			{ stdio: "inherit" },
		);
	} catch {
		// diff は差分があると exit 1 を返す。出力は stdio: "inherit" で既に出ている。
	}
}

const workDir = await mkdtemp(join(tmpdir(), "cf-skills-"));
let upstreamDrift = 0;
let expectedDrift = 0;
let failure = null;

try {
	for (const [name, upstreamPath] of FILES) {
		const [upstream, local] = await Promise.all([
			fetchUpstream(upstreamPath),
			readLocal(name),
		]);

		if (local === null) {
			console.log(`欠落   ${name}`);
			upstreamDrift += 1;
			continue;
		}

		if (upstream === local) {
			console.log(`一致   ${name}`);
			continue;
		}

		if (LOCALLY_MODIFIED.has(name)) {
			console.log(`改変   ${name} (ローカル改変あり。要目視確認)`);
			expectedDrift += 1;
		} else {
			console.log(`差分   ${name} <- ${upstreamPath}`);
			upstreamDrift += 1;
		}

		if (showDiff) {
			await printDiff(workDir, name, upstream, local);
		}
	}
} catch (error) {
	failure = error;
} finally {
	await rm(workDir, { recursive: true, force: true });
}

// 上流の取得失敗などの運用エラー。CI が「上流更新あり」(exit 1) と取り違えて
// Issue を立ててしまわないよう、別の終了コードで区別する。
if (failure) {
	console.error(`検査を完了できませんでした: ${failure.message}`);
	process.exit(2);
}

console.log();
if (upstreamDrift > 0) {
	console.log(
		`上流に ${upstreamDrift} 件の更新あり。取り込む場合は .claude/skills/README.md の「上流からの改変点」を当て直すこと。`,
	);
	process.exit(1);
}
if (expectedDrift > 0) {
	console.log(
		`上流の更新なし。ローカル改変 ${expectedDrift} 件は想定どおり (--diff で内容を確認できる)。`,
	);
} else {
	console.log("上流と完全に一致している。");
}
