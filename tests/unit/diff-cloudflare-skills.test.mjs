import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	EXIT_DRIFT,
	FILES,
	gitBlobSha,
	LOCALLY_MODIFIED,
} from "../../scripts/cloudflare-skills-manifest.mjs";
import {
	changedUpstream,
	vendoredUpstream,
} from "./fixtures/stub-upstream.mjs";

// 差分検査スクリプトを子プロセスとして実際に起動し、終了コードと出力を検査する。
// 通信は fixtures/stub-fetch.mjs が差し替えるので、上流の状態に左右されず必須チェックで走らせられる。
// 実際に import を評価するため、読み込みの壊れた変更もここで落ちる。
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCRIPT = join(ROOT, "scripts/diff-cloudflare-skills.mjs");
const STUB = new URL("./fixtures/stub-fetch.mjs", import.meta.url).href;
const TARGET = "workers-best-practices/references/platform-apis.md";

function runCheck(mode, { script = SCRIPT, target = TARGET } = {}) {
	return spawnSync(process.execPath, ["--import", STUB, script], {
		encoding: "utf8",
		env: {
			...process.env,
			STUB_FETCH_MODE: mode,
			STUB_FETCH_TARGET: target,
		},
	});
}

// スクリプト、定義ファイル、同梱ディレクトリを一時ディレクトリへ複製する。
// スクリプトは自分の位置から ../.claude/skills/ を読むため、複製した木を壊して試せる。
function withCopiedTree(fn) {
	const dir = mkdtempSync(join(tmpdir(), "diff-skills-test-"));
	try {
		mkdirSync(join(dir, "scripts"));
		for (const name of [
			"diff-cloudflare-skills.mjs",
			"cloudflare-skills-manifest.mjs",
		]) {
			copyFileSync(join(ROOT, "scripts", name), join(dir, "scripts", name));
		}
		cpSync(join(ROOT, ".claude/skills"), join(dir, ".claude/skills"), {
			recursive: true,
		});
		return fn(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function linesStartingWith(output, label) {
	return output.split("\n").filter((line) => line.startsWith(label));
}

test("gitBlobSha matches git hash-object", () => {
	// 期待値は git hash-object で求めたもの。スクリプトとスタブが同じ関数を共有するため、
	// この関数の誤りは下の起動テストでは見つからない。ここで既知の値と突き合わせる
	assert.equal(gitBlobSha(""), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
	assert.equal(
		gitBlobSha("hello\n"),
		"ce013625030ba8dba906f756967f9e9ca394464a",
	);
	// 長さは文字数ではなく UTF-8 のバイト数で数える
	assert.equal(
		gitBlobSha("日本語\n"),
		"c77dbef7f35c29e8829d98bf7fd8de21299e793b",
	);
	// BOM もバイト列の一部として含める
	assert.equal(
		gitBlobSha(Buffer.from([0xef, 0xbb, 0xbf, 0x62, 0x6f, 0x6d, 0x0a])),
		"3f5df30c51c893a455a49f62969c15f9bfd05e5b",
	);
});

test("every locally modified file records a blob SHA and is vendored", () => {
	// 値が上流のその版と一致するか (2 つの値の取り違えを含む) は通信を要するため、差分検査
	// (skills-drift.yml) に任せる。ここでは通信なしで分かる誤りだけを検出する
	const vendored = new Set(FILES.map(([local]) => local));
	for (const [name, sha] of LOCALLY_MODIFIED) {
		assert.ok(vendored.has(name), `${name} が FILES にない`);
		assert.match(
			sha,
			/^[0-9a-f]{40}$/,
			`${name} の値が git blob SHA (16 進 40 桁) ではない`,
		);
		// 改変の元にした版は改変前の内容なので、改変後の手元のファイルと同じ値にはならない
		assert.notEqual(
			sha,
			gitBlobSha(readFileSync(join(ROOT, ".claude/skills", name))),
			`${name} の値が改変後の手元のファイルの blob SHA になっている。改変の元にした上流の版の値を記録する`,
		);
	}
});

test("reports no drift when upstream matches apart from local modifications", () => {
	const result = runCheck("match");
	assert.equal(result.status, 0, result.stderr);
	assert.equal(
		linesStartingWith(result.stdout, "一致").length,
		FILES.length - LOCALLY_MODIFIED.size,
	);
	assert.equal(
		linesStartingWith(result.stdout, "改変").length,
		LOCALLY_MODIFIED.size,
	);
	assert.equal(linesStartingWith(result.stdout, "更新").length, 0);
	assert.match(result.stdout, /^一致 {3}LICENSE$/m);
});

test("exits with EXIT_DRIFT when an unmodified file changed upstream", () => {
	const result = runCheck("diff");
	assert.equal(result.status, EXIT_DRIFT, result.stderr);
	assert.match(result.stdout, new RegExp(`^差分 {3}${TARGET} <- `, "m"));
});

for (const name of LOCALLY_MODIFIED.keys()) {
	test(`exits with EXIT_DRIFT when upstream changed the locally modified ${name}`, () => {
		// 以前は全文を比べるだけだったため、このケースは「改変」のまま終了コード 0 になり見逃されていた
		const result = runCheck("diff", { target: name });
		assert.equal(result.status, EXIT_DRIFT, result.stderr);
		// 取り込み直す人は -> の右側の値を LOCALLY_MODIFIED に写し、左側の値で旧版を取り出す。
		// 形だけでなく値そのものを、スタブが返す内容から計算して確かめる
		const base = vendoredUpstream(
			readFileSync(join(ROOT, ".claude/skills", name), "utf8"),
		);
		const [line, ...rest] = linesStartingWith(result.stdout, "更新");
		assert.equal(rest.length, 0, result.stdout);
		assert.ok(
			line.startsWith(`更新   ${name} <- `),
			`「更新」の行が ${name} ではない: ${line}`,
		);
		assert.ok(
			line.endsWith(
				`blob ${gitBlobSha(base)} -> ${gitBlobSha(changedUpstream(base))})`,
			),
			`「更新」の行の blob SHA が、改変の元にした版と上流の新しい版の値ではない: ${line}`,
		);
		assert.equal(
			linesStartingWith(result.stdout, "改変").length,
			LOCALLY_MODIFIED.size - 1,
		);
	});
}

test("exits with EXIT_DRIFT when upstream removed a file (404)", () => {
	const result = runCheck("gone");
	assert.equal(result.status, EXIT_DRIFT, result.stderr);
	assert.match(result.stdout, new RegExp(`^消滅 {3}${TARGET} <- `, "m"));
});

test("exits with EXIT_DRIFT when a vendored file is missing locally", () => {
	withCopiedTree((dir) => {
		rmSync(join(dir, ".claude/skills", TARGET));
		const result = runCheck("match", {
			script: join(dir, "scripts/diff-cloudflare-skills.mjs"),
		});
		assert.equal(result.status, EXIT_DRIFT, result.stderr);
		assert.match(result.stdout, new RegExp(`^欠落 {3}${TARGET}$`, "m"));
		// 要対応が欠落の 1 件だけであること。複製した木ではスクリプトが複製側の定義ファイルを読むため、
		// スタブによる基準の登録がそちらに届いていなければ、改変したファイルが「更新」になり
		// 終了コードだけでは区別が付かない
		assert.equal(linesStartingWith(result.stdout, "欠落").length, 1);
		assert.equal(linesStartingWith(result.stdout, "更新").length, 0);
		assert.equal(
			linesStartingWith(result.stdout, "改変").length,
			LOCALLY_MODIFIED.size,
		);
	});
});

test("compares raw bytes so a file starting with a BOM still matches", () => {
	// Response.text() は先頭の BOM を取り除く。復号後の文字列で比べると、上流とバイト一致している
	// ファイルでも「差分」になり、改変したファイルでは blob SHA が GitHub の値と合わなくなる
	withCopiedTree((dir) => {
		const file = join(dir, ".claude/skills", TARGET);
		writeFileSync(
			file,
			Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), readFileSync(file)]),
		);
		const result = runCheck("match", {
			script: join(dir, "scripts/diff-cloudflare-skills.mjs"),
		});
		assert.equal(result.status, 0, result.stdout);
		assert.match(result.stdout, new RegExp(`^一致 {3}${TARGET}$`, "m"));
	});
});

test("reports an upstream HTTP error as a check failure, not drift", () => {
	const result = runCheck("http-error");
	assert.equal(result.status, 2);
	assert.match(result.stderr, /検査を完了できませんでした: 500 /);
});

test("reports a network error as a check failure with its cause", () => {
	const result = runCheck("network-error");
	assert.equal(result.status, 2);
	assert.match(
		result.stderr,
		/検査を完了できませんでした: fetch failed \(stub: connection refused\)/,
	);
});

test("a load-time error exits with Node's own code, never EXIT_DRIFT", () => {
	// node --check では見つからない読み込み時のエラー。Node は終了コード 1 で落ちる。
	// drift が専用の値なので、ワークフローはこれを「更新あり」と取り違えない
	withCopiedTree((dir) => {
		const manifest = join(dir, "scripts/cloudflare-skills-manifest.mjs");
		const source = readFileSync(manifest, "utf8");
		const broken = source.replace(
			"export const EXIT_DRIFT",
			"const EXIT_DRIFT",
		);
		assert.notEqual(broken, source, "EXIT_DRIFT の export を壊せていない");
		writeFileSync(manifest, broken);
		const result = runCheck("match", {
			script: join(dir, "scripts/diff-cloudflare-skills.mjs"),
		});
		assert.equal(result.status, 1);
		assert.notEqual(result.status, EXIT_DRIFT);
		assert.match(
			result.stderr,
			/does not provide an export named 'EXIT_DRIFT'/,
		);
	});
});
