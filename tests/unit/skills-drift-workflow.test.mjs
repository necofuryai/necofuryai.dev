import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { EXIT_DRIFT } from "../../scripts/cloudflare-skills-manifest.mjs";

// .github/workflows/skills-drift.yml の "Check for drift" ステップの本文を取り出し、GitHub Actions の
// shell: bash と同じ `bash --noprofile --norc -e -o pipefail` で実行して、終了コードの分類を検査する。
// スクリプト側の契約 (diff-cloudflare-skills.test.mjs) と対にして、両側がずれたら落ちるようにしている。
// PR #160 で直した `bash -e` によるステップの打ち切りも、ここで再発を検出できる。
const WORKFLOW = new URL(
	"../../.github/workflows/skills-drift.yml",
	import.meta.url,
);
const skip =
	process.platform === "win32" ? "bash と POSIX の PATH が前提" : false;

// YAML パーサは依存にないため、行単位で run: | のブロックを取り出す。
// ワークフローの形が変わって取り出せなくなったら、空振りせずに失敗させる。
function extractCheckStep(yaml) {
	const lines = yaml.split(/\r?\n/);
	const nameIndex = lines.findIndex((line) =>
		/^\s*- name: Check for drift\s*$/.test(line),
	);
	assert.notEqual(nameIndex, -1, "Check for drift ステップが見つからない");
	const runIndex = lines.findIndex(
		(line, index) => index > nameIndex && /^\s*run: \|\s*$/.test(line),
	);
	assert.notEqual(runIndex, -1, "run: | が見つからない");
	assert.ok(
		!lines.slice(nameIndex + 1, runIndex).some((line) => /^\s*- /.test(line)),
		"run: | が Check for drift ステップの外にある",
	);

	const runIndent = lines[runIndex].search(/\S/);
	const body = [];
	for (const line of lines.slice(runIndex + 1)) {
		if (line.trim() !== "" && line.search(/\S/) <= runIndent) break;
		body.push(line);
	}
	const indent = Math.min(
		...body
			.filter((line) => line.trim() !== "")
			.map((line) => line.search(/\S/)),
	);
	const script = body.map((line) => line.slice(indent)).join("\n");
	assert.match(script, /case "\$rc" in/, "分類処理 (case) を取り出せていない");
	return script;
}

const STEP = extractCheckStep(readFileSync(WORKFLOW, "utf8"));

// 偽の node は stdout と stderr の両方に書く。ステップは 2>&1 で両方をレポートとして受け取り、
// 失敗時もその内容 (スクリプトが stderr に出す失敗の原因) をログへ出す必要がある
const FAKE_REPORT = "fake report\nfake cause";

function expectedGithubOutput(drift) {
	return `drift=${drift}\nreport<<DRIFT_REPORT_EOF\n${FAKE_REPORT}\nDRIFT_REPORT_EOF\n`;
}

// 差分検査スクリプトの代わりに、指定した終了コードで終わる偽の node を PATH の先頭に置いて実行する
function runStep(exitCode) {
	const dir = mkdtempSync(join(tmpdir(), "skills-drift-step-"));
	try {
		const bin = join(dir, "bin");
		mkdirSync(bin);
		const fakeNode = join(bin, "node");
		writeFileSync(
			fakeNode,
			`#!/bin/sh\necho "fake report"\necho "fake cause" >&2\nexit ${exitCode}\n`,
		);
		chmodSync(fakeNode, 0o755);
		const stepFile = join(dir, "step.sh");
		writeFileSync(stepFile, STEP);
		const githubOutput = join(dir, "github_output");
		writeFileSync(githubOutput, "");
		const result = spawnSync(
			"bash",
			["--noprofile", "--norc", "-e", "-o", "pipefail", stepFile],
			{
				encoding: "utf8",
				env: {
					...process.env,
					PATH: `${bin}${delimiter}${process.env.PATH}`,
					GITHUB_OUTPUT: githubOutput,
				},
			},
		);
		return { ...result, githubOutput: readFileSync(githubOutput, "utf8") };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test("exit 0 is reported as no drift", { skip }, () => {
	const result = runStep(0);
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.githubOutput, expectedGithubOutput("false"));
	assert.ok(result.stdout.includes(FAKE_REPORT));
});

test("EXIT_DRIFT is reported as drift with the report", { skip }, () => {
	const result = runStep(EXIT_DRIFT);
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.githubOutput, expectedGithubOutput("true"));
	assert.ok(result.stdout.includes(FAKE_REPORT));
});

for (const exitCode of [1, 2, 13]) {
	test(`exit ${exitCode} fails the step without reporting drift`, {
		skip,
	}, () => {
		// 1 は読み込み時のエラーなど Node 自身の異常終了、2 は捕捉した例外、13 は未解決のトップレベル await
		const result = runStep(exitCode);
		assert.equal(result.status, exitCode);
		assert.equal(result.githubOutput, "");
		// 失敗の原因 (stderr) を含むレポートが、ステップを止める前にログへ出ていること
		assert.ok(result.stdout.includes(FAKE_REPORT));
		assert.match(result.stdout, /^::error::/m);
	});
}
