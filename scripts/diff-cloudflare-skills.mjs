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
 * 意図的にローカル改変しているファイル (cloudflare-skills-manifest.mjs の LOCALLY_MODIFIED) は
 * 手元と上流が食い違って当然なので、全文ではなく、上流の blob SHA を改変の元にした版の値と比べる。
 * 上流がその版のままなら「改変」として終了コードに影響させず、変わっていれば「更新」として報告する。
 * 改変した旨は各ファイル冒頭の告知に、改変の詳細は .claude/skills/README.md の「上流からの改変点」に
 * 記録している。告知の有無は通信を要しないので、ここではなく必須チェックで走る
 * tests/unit/vendored-skills-notice.test.mjs が検査する。
 *
 * 終了コード (.github/workflows/skills-drift.yml がこの区別に依存している):
 * - 0: 対応不要 (完全一致、またはローカル改変のみで上流は改変の元にした版のまま)
 * - 20 (EXIT_DRIFT): 要対応 (上流が更新・削除・移動された、またはファイルが欠落している)
 * - それ以外: 検査自体が失敗した。捕捉した例外 (上流の取得エラーなど) は 2 で報告するが、
 *   読み込み時のエラーなど Node 自身の異常終了は 1 などになる。drift を専用の値にしているので、
 *   どちらも「要対応」と取り違えられることはない
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	EXIT_DRIFT,
	FILES,
	gitBlobSha,
	LOCALLY_MODIFIED,
	UPSTREAM,
} from "./cloudflare-skills-manifest.mjs";

const SKILLS_DIR = new URL("../.claude/skills/", import.meta.url);

const showDiff = process.argv.includes("--diff");

// 404 は上流でファイルが削除・移動されたことを示す取り込み待ちの更新であり、検査の失敗ではない。
// 例外にすると終了コード 2 になり、週次実行で Issue が立たないまま赤が続く (2026-09 に実際に起きた)。
// それ以外の失敗 (5xx・レート制限・ネットワーク断) は一時的でありうるので従来どおり 2 にする。
//
// 内容は文字列に復号せずバイト列のまま扱う。text() は先頭の BOM を取り除くため、復号後の文字列から
// 求めた blob SHA は GitHub や git hash-object の値と合わないことがある。
async function fetchUpstream(path) {
	const response = await fetch(`${UPSTREAM}/${path}`);
	if (response.status === 404) return null;
	if (!response.ok) {
		throw new Error(`${response.status} ${response.statusText}: ${path}`);
	}
	return Buffer.from(await response.arrayBuffer());
}

async function readLocal(path) {
	try {
		return await readFile(new URL(path, SKILLS_DIR));
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

// 検査の失敗を原因付きのメッセージと終了コード 2 で報告する。「上流更新あり」は EXIT_DRIFT で
// 報告するので、CI はこれを含む EXIT_DRIFT 以外の非 0 をすべて検査の失敗として扱う。
function exitAsCheckFailure(error) {
	// fetch の失敗は message が一律 "fetch failed" になり原因が分からないため cause も出す
	// (DNS 解決不能、証明書エラー、プロキシ経由が必要、などの区別がこれで付く)
	const cause = error?.cause?.message ?? error?.cause;
	console.error(
		`検査を完了できませんでした: ${error?.message ?? error}${cause ? ` (${cause})` : ""}`,
	);
	process.exit(2);
}

// 捕捉漏れの例外も、原因付きのメッセージで検査の失敗として報告する。
// reject されたトップレベル await もここに届く。
process.on("uncaughtException", exitAsCheckFailure);

let workDir = null;
let upstreamDrift = 0;
let expectedDrift = 0;
let failure = null;

try {
	workDir = await mkdtemp(join(tmpdir(), "cf-skills-"));
	for (const [name, upstreamPath] of FILES) {
		const [upstream, local] = await Promise.all([
			fetchUpstream(upstreamPath),
			readLocal(name),
		]);

		if (upstream === null) {
			console.log(`消滅   ${name} <- ${upstreamPath} (上流で削除または移動)`);
			upstreamDrift += 1;
			continue;
		}

		if (local === null) {
			console.log(`欠落   ${name}`);
			upstreamDrift += 1;
			continue;
		}

		if (upstream.equals(local)) {
			console.log(`一致   ${name}`);
			continue;
		}

		const baseline = LOCALLY_MODIFIED.get(name);
		if (baseline === undefined) {
			console.log(`差分   ${name} <- ${upstreamPath}`);
			upstreamDrift += 1;
		} else if (gitBlobSha(upstream) === baseline) {
			console.log(
				`改変   ${name} (ローカル改変あり。上流は改変の元にした版のまま)`,
			);
			expectedDrift += 1;
		} else {
			// 取り込み直すときに LOCALLY_MODIFIED の値を更新できるよう、新しい版の blob SHA を出す
			console.log(
				`更新   ${name} <- ${upstreamPath} (改変の元にした版から上流が更新された。blob ${baseline} -> ${gitBlobSha(upstream)})`,
			);
			upstreamDrift += 1;
		}

		if (showDiff) {
			await printDiff(workDir, name, upstream, local);
		}
	}
} catch (error) {
	failure = error;
} finally {
	if (workDir) await rm(workDir, { recursive: true, force: true });
}

// 上流の取得失敗などの運用エラー
if (failure) exitAsCheckFailure(failure);

console.log();
if (upstreamDrift > 0) {
	console.log(
		`上流に ${upstreamDrift} 件の更新あり。取り込む手順は .claude/skills/README.md の「上流への再同期」を参照 (改変したファイルは「上流からの改変点」を当て直し、LOCALLY_MODIFIED の blob SHA を更新する)。`,
	);
	process.exit(EXIT_DRIFT);
}
if (expectedDrift > 0) {
	console.log(
		`上流の更新なし。ローカル改変 ${expectedDrift} 件は想定どおり (--diff で内容を確認できる)。`,
	);
} else {
	console.log("上流と完全に一致している。");
}
