import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { extractRunScript } from "./fixtures/workflow-step.mjs";

// .github/workflows/dependabot-advisory-review.yml の analyze ジョブが、Action の structured_output を
// base64 の一行 job output にして comment ジョブへ渡すことを確かめる。受け渡しを間違えると
// structured_output が常に空になり、comment ジョブが黙って skip されるので、配線と境界の両方を見る。
const WORKFLOW = readFileSync(
	new URL(
		"../../.github/workflows/dependabot-advisory-review.yml",
		import.meta.url,
	),
	"utf8",
);
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const STEP = "Encode structured advisory output";
// step が job output に渡す上限。comment ジョブの renderer も同じ 64 KiB で検査する
const MAX_BYTES = 65536;
const skip =
	process.platform === "win32" ? "bash と POSIX の PATH が前提" : false;

// GitHub Actions の式 `${{ <path> }}` を組み立てる。文字列に直接書くと、
// テンプレートリテラルの書き忘れと区別できないため
const expression = (path) => ["$", "{{ ", path, " }}"].join("");

// ステップの - name: から run: | までにある if と env を取り出す
function stepHeader(stepName) {
	const lines = WORKFLOW.split(/\r?\n/);
	const start = lines.findIndex(
		(line) => line.trim() === `- name: ${stepName}`,
	);
	assert.notEqual(start, -1, `${stepName} ステップが見つからない`);
	const run = lines.findIndex(
		(line, index) => index > start && /^\s*run: \|\s*$/.test(line),
	);
	const header = { env: {} };
	for (const line of lines.slice(start + 1, run)) {
		const condition = line.match(/^\s+if: (.+)$/);
		if (condition) header.if = condition[1];
		const id = line.match(/^\s+id: (.+)$/);
		if (id) header.id = id[1];
		const entry = line.match(/^\s+([A-Z_]+): (.+)$/);
		if (entry) header.env[entry[1]] = entry[2];
	}
	return header;
}

// 2 字下げの `  <name>:` の行番号
function jobLine(name) {
	const index = WORKFLOW.split(/\r?\n/).indexOf(`  ${name}:`);
	assert.notEqual(index, -1, `${name} ジョブが見つからない`);
	return index;
}

function stepLine(name) {
	const index = WORKFLOW.split(/\r?\n/).findIndex(
		(line) => line.trim() === `- name: ${name}`,
	);
	assert.notEqual(index, -1, `${name} ステップが見つからない`);
	return index;
}

// GitHub Actions の shell: bash と同じ `bash --noprofile --norc -e -o pipefail` で本物の step を実行し、
// GITHUB_OUTPUT に書かれた行を返す。ロケールは Ubuntu runner と同じ C.UTF-8 にする。C ロケールの bash は
// ${#var} でも byte 数を数えるので、byte 数を文字数で数える誤りを見逃す
function runStep(structuredOutput) {
	const dir = mkdtempSync(join(tmpdir(), "advisory-encode-step-"));
	try {
		const githubOutput = join(dir, "github-output");
		writeFileSync(githubOutput, "");
		const stepFile = join(dir, "step.sh");
		writeFileSync(stepFile, extractRunScript(WORKFLOW, STEP));
		const result = spawnSync(
			"bash",
			["--noprofile", "--norc", "-e", "-o", "pipefail", stepFile],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: {
					...process.env,
					LC_ALL: "C.UTF-8",
					STRUCTURED_OUTPUT: structuredOutput,
					GITHUB_OUTPUT: githubOutput,
				},
			},
		);
		const outputs = readFileSync(githubOutput, "utf8")
			.split("\n")
			.filter(Boolean);
		return { ...result, outputs };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// UTF-8 でちょうど bytes byte の文字列。3 byte の「あ」で埋めるので、文字数で数える実装とは結果が分かれる
function utf8OfLength(bytes) {
	const wide = "あ".repeat(Math.floor(bytes / 3));
	return wide + "a".repeat(bytes - Buffer.byteLength(wide, "utf8"));
}

// GITHUB_OUTPUT の advisory_b64 行がただ一つで、改行の無い base64 であることを確かめて復号する
function decodedAdvisory(outputs) {
	assert.equal(outputs.length, 1, outputs.join("\n"));
	const match = outputs[0].match(/^advisory_b64=([+/0-9A-Za-z]+={0,2})$/);
	assert.ok(match, "advisory_b64 is not a single base64 line");
	return Buffer.from(match[1], "base64").toString("utf8");
}

test("the step reads the Claude step's structured_output only after a successful run", () => {
	const header = stepHeader(STEP);
	assert.equal(
		header.if,
		"steps.gate.outputs.run_claude == 'true' && steps.claude.outcome == 'success'",
	);
	assert.equal(header.id, "extract");
	assert.deepEqual(header.env, {
		STRUCTURED_OUTPUT: expression("steps.claude.outputs.structured_output"),
	});
});

test("the analyze job hands the encoded advisory to the comment job", () => {
	assert.ok(
		WORKFLOW.split(/\r?\n/).includes(
			`      advisory_b64: ${expression("steps.extract.outputs.advisory_b64")}`,
		),
	);
	const claude = stepLine("Run Claude advisory analysis");
	const encode = stepLine(STEP);
	assert.ok(
		jobLine("analyze") < claude &&
			claude < encode &&
			encode < jobLine("comment"),
	);
});

test("an empty structured_output warns and passes nothing on", {
	skip,
}, () => {
	const run = runStep("");
	assert.equal(run.status, 0, run.stderr);
	assert.match(run.stdout, /^::warning::no structured output/m);
	assert.deepEqual(run.outputs, []);
});

test("an output of exactly the byte limit is passed on unchanged", {
	skip,
}, () => {
	const value = utf8OfLength(MAX_BYTES);
	const run = runStep(value);
	assert.equal(run.status, 0, run.stderr);
	assert.equal(decodedAdvisory(run.outputs), value);
});

test("an output one byte over the limit is skipped", { skip }, () => {
	const run = runStep(utf8OfLength(MAX_BYTES + 1));
	assert.equal(run.status, 0, run.stderr);
	assert.match(run.stdout, /exceeds 65536 bytes/);
	assert.deepEqual(run.outputs, []);
});

test("the comment renderer accepts what the step passes on", { skip }, () => {
	const text = "あ".repeat(500);
	const advisory = JSON.stringify({
		update_impact: text,
		release_note_checks: Array(10).fill(text),
		related_components: Array(10).fill(text),
		human_followups: Array(10).fill(text),
	});
	const run = runStep(advisory);
	assert.equal(run.status, 0, run.stderr);
	const encoded = run.outputs[0].slice("advisory_b64=".length);
	const dir = mkdtempSync(join(tmpdir(), "advisory-encode-render-"));
	try {
		const input = join(dir, "advisory.b64");
		writeFileSync(input, encoded);
		const render = spawnSync(
			process.execPath,
			[
				"scripts/ci/render-advisory-comment.mjs",
				input,
				join(dir, "advisory-body.md"),
			],
			{ cwd: REPO_ROOT, encoding: "utf8" },
		);
		assert.equal(render.status, 0, render.stderr);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
