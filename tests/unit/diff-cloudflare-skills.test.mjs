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
	LOCALLY_MODIFIED,
} from "../../scripts/cloudflare-skills-manifest.mjs";

// 差分検査スクリプトを子プロセスとして実際に起動し、終了コードと出力を検査する。
// 通信は fixtures/stub-fetch.mjs が差し替えるので、上流の状態に左右されず必須チェックで走らせられる。
// 実際に import を評価するため、読み込みの壊れた変更もここで落ちる。
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCRIPT = join(ROOT, "scripts/diff-cloudflare-skills.mjs");
const STUB = new URL("./fixtures/stub-fetch.mjs", import.meta.url).href;
const TARGET = "workers-best-practices/references/platform-apis.md";

function runCheck(mode, script = SCRIPT) {
	return spawnSync(process.execPath, ["--import", STUB, script], {
		encoding: "utf8",
		env: {
			...process.env,
			STUB_FETCH_MODE: mode,
			STUB_FETCH_TARGET: TARGET,
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
	assert.match(result.stdout, /^一致 {3}LICENSE$/m);
});

test("exits with EXIT_DRIFT when an unmodified file changed upstream", () => {
	const result = runCheck("diff");
	assert.equal(result.status, EXIT_DRIFT, result.stderr);
	assert.match(result.stdout, new RegExp(`^差分 {3}${TARGET} <- `, "m"));
});

test("exits with EXIT_DRIFT when upstream removed a file (404)", () => {
	const result = runCheck("gone");
	assert.equal(result.status, EXIT_DRIFT, result.stderr);
	assert.match(result.stdout, new RegExp(`^消滅 {3}${TARGET} <- `, "m"));
});

test("exits with EXIT_DRIFT when a vendored file is missing locally", () => {
	withCopiedTree((dir) => {
		rmSync(join(dir, ".claude/skills", TARGET));
		const result = runCheck(
			"match",
			join(dir, "scripts/diff-cloudflare-skills.mjs"),
		);
		assert.equal(result.status, EXIT_DRIFT, result.stderr);
		assert.match(result.stdout, new RegExp(`^欠落 {3}${TARGET}$`, "m"));
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
		const result = runCheck(
			"match",
			join(dir, "scripts/diff-cloudflare-skills.mjs"),
		);
		assert.equal(result.status, 1);
		assert.notEqual(result.status, EXIT_DRIFT);
		assert.match(
			result.stderr,
			/does not provide an export named 'EXIT_DRIFT'/,
		);
	});
});
