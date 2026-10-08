import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { extractRunScript } from "./fixtures/workflow-step.mjs";

// .github/workflows/dependabot-advisory-review.yml の bundle の受け渡しを検査する。
// preflight が作った raw bundle は sanitize が作り直す前に、sanitized bundle は analyze が Claude へ
// 渡す前に、manifest の source_run_id、pr_number、head_sha を preflight の job output と照合し、
// ファイルの組と各 SHA-256 も確かめる。どちらかが欠けると、差し替えた bundle がそのまま Claude に届く。
const WORKFLOW = readFileSync(
	new URL(
		"../../.github/workflows/dependabot-advisory-review.yml",
		import.meta.url,
	),
	"utf8",
);
const skip =
	process.platform === "win32" ? "bash と POSIX の PATH が前提" : false;

const SOURCE_RUN_ID = "36930226682";
const PR_NUMBER = "171";
const HEAD_SHA = "ea82b8c06bdb4847593ce8d56f58e431ee7d1c33";
const BUNDLE = {
	"checks-summary.txt": "ci: completed success\n",
	"diff.patch": "diff --git a/x b/x\n",
	"pr-body-excerpt.txt": "Bumps x from 1.0.0 to 1.0.1.\n",
};
// GitHub Actions の式 `${{ <path> }}` を組み立てる。文字列に直接書くと、
// テンプレートリテラルの書き忘れと区別できないため
const expression = (path) => ["$", "{{ ", path, " }}"].join("");
const EXPECTED_ENV = {
	EXPECTED_SOURCE_RUN_ID: expression("needs.preflight.outputs.run_id"),
	EXPECTED_PR: expression("needs.preflight.outputs.pr_number"),
	EXPECTED_SHA: expression("needs.preflight.outputs.head_sha"),
};

// 2 字下げの `  <name>:` から次のジョブまでを、そのジョブの定義として返す
function jobBlock(name) {
	const lines = WORKFLOW.split(/\r?\n/);
	const start = lines.indexOf(`  ${name}:`);
	assert.notEqual(start, -1, `${name} ジョブが見つからない`);
	const end = lines.findIndex(
		(line, index) => index > start && /^ {2}\S/.test(line),
	);
	return lines.slice(start, end === -1 ? undefined : end);
}

// ジョブの中で run: | を持つステップの名前を、定義の順に返す
function runStepNames(job) {
	const names = [];
	let current;
	for (const line of jobBlock(job)) {
		const name = line.match(/^\s+- name: (.+)$/);
		if (name) current = name[1];
		else if (/^\s+run: \|\s*$/.test(line) && current) {
			names.push(current);
			current = undefined;
		}
	}
	return names;
}

// ステップの - name: から run: | までにある大文字の env キーを取り出す
function stepEnv(stepName) {
	const lines = WORKFLOW.split(/\r?\n/);
	const start = lines.findIndex(
		(line) => line.trim() === `- name: ${stepName}`,
	);
	assert.notEqual(start, -1, `${stepName} ステップが見つからない`);
	const run = lines.findIndex(
		(line, index) => index > start && /^\s*run: \|\s*$/.test(line),
	);
	const env = {};
	for (const line of lines.slice(start + 1, run)) {
		const entry = line.match(/^\s+([A-Z_]+): (.+)$/);
		if (entry) env[entry[1]] = entry[2];
	}
	return env;
}

// preflight の "Collect raw inputs as untrusted data" と同じ形の bundle を書く。
// mutate で manifest を、files で中身を差し替えられる
function writeBundle(dir, { files = BUNDLE, mutate = (manifest) => manifest }) {
	mkdirSync(dir, { recursive: true });
	for (const [name, content] of Object.entries(files)) {
		writeFileSync(join(dir, name), content);
	}
	const manifest = mutate({
		source_run_id: SOURCE_RUN_ID,
		pr_number: PR_NUMBER,
		head_sha: HEAD_SHA,
		files: Object.entries(files).map(([name, content]) => ({
			name,
			sha256: createHash("sha256").update(content).digest("hex"),
		})),
	});
	writeFileSync(
		join(dir, "manifest.json"),
		JSON.stringify(manifest, null, "\t"),
	);
}

// GitHub Actions の shell: bash と同じ `bash --noprofile --norc -e -o pipefail` で実行する
function runScript(script, { env, cwd }) {
	const file = join(
		cwd,
		`step-${createHash("sha256").update(script).digest("hex").slice(0, 8)}.sh`,
	);
	writeFileSync(file, script);
	return spawnSync(
		"bash",
		["--noprofile", "--norc", "-e", "-o", "pipefail", file],
		{ encoding: "utf8", cwd, env: { ...process.env, ...env } },
	);
}

function expectedEnv(overrides = {}) {
	return {
		EXPECTED_SOURCE_RUN_ID: SOURCE_RUN_ID,
		EXPECTED_PR: PR_NUMBER,
		EXPECTED_SHA: HEAD_SHA,
		...overrides,
	};
}

// sanitize ジョブの run ステップを順に実行し、最初に失敗した結果か最後の結果を返す
function runSanitizeJob({ runnerTemp, env }) {
	let result;
	for (const name of runStepNames("sanitize")) {
		result = runScript(extractRunScript(WORKFLOW, name), {
			cwd: runnerTemp,
			env: { RUNNER_TEMP: runnerTemp, ...env },
		});
		if (result.status !== 0) return { ...result, failedStep: name };
	}
	return result;
}

function withTempDir(prefix, fn) {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	try {
		return fn(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test("preflight exposes the source run id as a job output", () => {
	assert.ok(
		jobBlock("preflight").some(
			(line) =>
				line.trim() ===
				`run_id: ${expression("steps.validate.outputs.run_id")}`,
		),
		"preflight の outputs に run_id がない (宣言を忘れると実行時に空文字になる)",
	);
});

test("both manifest checks receive the preflight job outputs", () => {
	assert.deepEqual(stepEnv("Verify raw manifest"), EXPECTED_ENV);
	assert.deepEqual(stepEnv("Verify sanitized manifest"), EXPECTED_ENV);
});

test("sanitize verifies the raw manifest before rebuilding it", () => {
	const steps = runStepNames("sanitize");
	assert.ok(
		steps.indexOf("Verify raw manifest") !== -1 &&
			steps.indexOf("Verify raw manifest") < steps.indexOf("Sanitize bundle"),
		`sanitize の run ステップの順序: ${steps.join(", ")}`,
	);
});

test("the analyze token has no actions scope", () => {
	const job = jobBlock("analyze");
	const start = job.findIndex((line) => line.trim() === "permissions:");
	assert.notEqual(start, -1, "analyze に permissions がない");
	const scopes = [];
	for (const line of job.slice(start + 1)) {
		const scope = line.match(/^ {6}([a-z-]+): (\w+)$/);
		if (!scope) break;
		scopes.push(`${scope[1]}: ${scope[2]}`);
	}
	assert.deepEqual(scopes, ["contents: read", "pull-requests: read"]);
});

// 偽の gh。preflight の収集ステップが呼ぶ 3 種類の API だけに答える
const FAKE_GH = `#!/bin/sh
case "$*" in
*application/vnd.github.v3.diff*) cat "$FAKE_GH_DIR/diff" ;;
*check-runs*) cat "$FAKE_GH_DIR/checks" ;;
*.body*) cat "$FAKE_GH_DIR/body" ;;
*) echo "unexpected gh call: $*" >&2; exit 99 ;;
esac
`;

// 本物の収集ステップから sanitize、analyze の照合までを通し、manifest の項目名や型が
// 作る側と確かめる側でずれていないことを確かめる。tamper を渡すと、収集の後に raw bundle を書き換える
function runChain({ tamper } = {}) {
	return withTempDir("advisory-manifest-chain-", (dir) => {
		const bin = join(dir, "bin");
		const responses = join(dir, "responses");
		const runnerTemp = join(dir, "runner-temp");
		const workspace = join(dir, "workspace");
		for (const path of [bin, responses, runnerTemp, workspace]) mkdirSync(path);
		writeFileSync(join(bin, "gh"), FAKE_GH);
		chmodSync(join(bin, "gh"), 0o755);
		writeFileSync(join(responses, "diff"), BUNDLE["diff.patch"]);
		writeFileSync(join(responses, "body"), BUNDLE["pr-body-excerpt.txt"]);
		writeFileSync(join(responses, "checks"), BUNDLE["checks-summary.txt"]);

		const collect = runScript(
			extractRunScript(WORKFLOW, "Collect raw inputs as untrusted data"),
			{
				cwd: runnerTemp,
				env: {
					PATH: `${bin}${delimiter}${process.env.PATH}`,
					FAKE_GH_DIR: responses,
					RUNNER_TEMP: runnerTemp,
					GITHUB_REPOSITORY: "owner/repo",
					SOURCE_RUN_ID,
					PR_NUMBER,
					HEAD_SHA,
				},
			},
		);
		assert.equal(collect.status, 0, collect.stderr);
		tamper?.(join(runnerTemp, "claude-raw"));

		const sanitize = runSanitizeJob({ runnerTemp, env: expectedEnv() });
		if (sanitize.status !== 0) return { sanitize };

		cpSync(
			join(runnerTemp, "claude-sanitized"),
			join(workspace, ".claude-review-input"),
			{ recursive: true },
		);
		const analyze = runScript(
			extractRunScript(WORKFLOW, "Verify sanitized manifest"),
			{ cwd: workspace, env: expectedEnv() },
		);
		return { sanitize, analyze };
	});
}

test("an untouched bundle passes from collection to analyze", { skip }, () => {
	const { sanitize, analyze } = runChain();
	assert.equal(sanitize.status, 0, sanitize.stderr);
	assert.equal(analyze.status, 0, analyze.stderr);
});

test("a raw file rewritten after collection stops the sanitize job", {
	skip,
}, () => {
	const { sanitize, analyze } = runChain({
		tamper: (raw) => writeFileSync(join(raw, "diff.patch"), "injected\n"),
	});
	assert.equal(
		sanitize.status,
		1,
		"改ざんした raw bundle が sanitize を通った",
	);
	assert.match(sanitize.stderr, /sha256 mismatch: diff\.patch/);
	assert.equal(analyze, undefined);
});

// raw bundle の照合だけを、ずらした manifest や期待値で実行する
function runRawCheck({ bundle = {}, env = {}, after } = {}) {
	return withTempDir("advisory-raw-check-", (runnerTemp) => {
		const raw = join(runnerTemp, "claude-raw");
		writeBundle(raw, bundle);
		after?.(raw);
		return runScript(extractRunScript(WORKFLOW, "Verify raw manifest"), {
			cwd: runnerTemp,
			env: { RUNNER_TEMP: runnerTemp, ...expectedEnv(env) },
		});
	});
}

const DIFFERENT_SHA = "0123456789abcdef0123456789abcdef01234567";

for (const [label, options, message] of [
	[
		"a different source run id",
		{ env: { EXPECTED_SOURCE_RUN_ID: "36930226683" } },
		/source_run_id mismatch/,
	],
	[
		"a different PR number",
		{ env: { EXPECTED_PR: "172" } },
		/pr_number mismatch/,
	],
	[
		"a different head SHA",
		{ env: { EXPECTED_SHA: DIFFERENT_SHA } },
		/head_sha mismatch/,
	],
	[
		"a numeric source run id in the manifest",
		{
			bundle: {
				mutate: (m) => ({ ...m, source_run_id: Number(SOURCE_RUN_ID) }),
			},
		},
		/source_run_id mismatch/,
	],
	[
		"an empty expected run id matching an empty manifest value",
		{
			bundle: { mutate: (m) => ({ ...m, source_run_id: "" }) },
			env: { EXPECTED_SOURCE_RUN_ID: "" },
		},
		/expected source_run_id is not numeric/,
	],
	[
		"a missing bundle file",
		{ after: (raw) => unlinkSync(join(raw, "pr-body-excerpt.txt")) },
		/bundle directory has unexpected or missing files/,
	],
	[
		"an extra file in the bundle",
		{ after: (raw) => writeFileSync(join(raw, "extra.txt"), "x") },
		/bundle directory has unexpected or missing files/,
	],
	[
		"a manifest entry outside the bundle",
		{
			bundle: {
				mutate: (m) => ({
					...m,
					files: [...m.files, { name: "../outside", sha256: "0".repeat(64) }],
				}),
			},
		},
		/manifest file list differs from the bundle/,
	],
]) {
	test(`the raw manifest check rejects ${label}`, { skip }, () => {
		const result = runRawCheck(options);
		assert.equal(result.status, 1, `通ってしまった: ${result.stdout}`);
		assert.match(result.stderr, message);
	});
}

// analyze の照合を、sanitized bundle に見立てた .claude-review-input で実行する
function runAnalyzeCheck({ env = {}, after } = {}) {
	return withTempDir("advisory-analyze-check-", (workspace) => {
		const input = join(workspace, ".claude-review-input");
		writeBundle(input, {});
		after?.(input);
		return runScript(extractRunScript(WORKFLOW, "Verify sanitized manifest"), {
			cwd: workspace,
			env: expectedEnv(env),
		});
	});
}

for (const [label, options, message] of [
	[
		"a different source run id",
		{ env: { EXPECTED_SOURCE_RUN_ID: "36930226683" } },
		/source_run_id mismatch/,
	],
	[
		"an empty expected run id",
		{ env: { EXPECTED_SOURCE_RUN_ID: "" } },
		/expected source_run_id is not numeric/,
	],
	[
		"an extra file next to the bundle",
		{ after: (input) => writeFileSync(join(input, "extra.txt"), "x") },
		/bundle directory has unexpected or missing files/,
	],
	[
		"a rewritten bundle file",
		{
			after: (input) => writeFileSync(join(input, "diff.patch"), "injected\n"),
		},
		/sha256 mismatch: diff\.patch/,
	],
]) {
	test(`the sanitized manifest check rejects ${label}`, { skip }, () => {
		const result = runAnalyzeCheck(options);
		assert.equal(result.status, 1, `通ってしまった: ${result.stdout}`);
		assert.match(result.stderr, message);
	});
}
