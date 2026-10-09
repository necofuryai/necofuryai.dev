import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { extractRunScript } from "./fixtures/workflow-step.mjs";

// .github/workflows/dependabot-advisory-review.yml の analyze ジョブが、どのモデルが応答したかを
// run の step summary に残すことを確かめる。Claude の step は分類器による再実行でも success で
// 終わるので、この記録が無いと Sonnet 5 が答えた run を見分けられない。summary は run を開ける人なら
// 誰でも読めるため、Claude の本文が summary に出ないことも確かめる。
const WORKFLOW = readFileSync(
	new URL(
		"../../.github/workflows/dependabot-advisory-review.yml",
		import.meta.url,
	),
	"utf8",
);
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const STEP = "Record the responding model in the step summary";
const skip =
	process.platform === "win32" ? "bash と POSIX の PATH が前提" : false;
// root はファイルのモードを無視するので、読めないファイルを作れない
const skipUnreadable =
	skip ||
	(process.getuid?.() === 0 ? "root では読めないファイルを作れない" : false);

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

const EXECUTION = [
	{ type: "system", subtype: "init", model: "claude-sonnet-5-5" },
	{
		type: "assistant",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "SECRET-ASSISTANT-TEXT" }],
		},
	},
	{
		type: "result",
		subtype: "success",
		num_turns: 13,
		total_cost_usd: 0.0763,
		permission_denials: [],
		modelUsage: {
			"claude-sonnet-5-5": {
				inputTokens: 1200,
				cacheReadInputTokens: 25000,
				outputTokens: 340,
				costUSD: 0.07,
			},
			"claude-sonnet-5": {
				inputTokens: 100,
				cacheReadInputTokens: 0,
				outputTokens: 50,
				costUSD: 0.0063,
			},
		},
	},
];

// GitHub Actions の shell: bash と同じ `bash --noprofile --norc -e -o pipefail` で、
// 本物の step を repository root から実行する (node scripts/ci/... の相対パスのため)。
// unreadable を立てると execution file をモード 000 にして、summary script の失敗を起こす
function runStep({ execution, outcome, unreadable = false }) {
	const dir = mkdtempSync(join(tmpdir(), "advisory-summary-step-"));
	try {
		const summary = join(dir, "step-summary.md");
		writeFileSync(summary, "");
		let executionFile = "";
		if (execution !== undefined) {
			executionFile = join(dir, "claude-execution-output.json");
			writeFileSync(
				executionFile,
				typeof execution === "string" ? execution : JSON.stringify(execution),
			);
			if (unreadable) chmodSync(executionFile, 0o000);
		}
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
					EXECUTION_FILE: executionFile,
					CLAUDE_OUTCOME: outcome,
					GITHUB_STEP_SUMMARY: summary,
				},
			},
		);
		return { ...result, summary: readFileSync(summary, "utf8") };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test("the step runs whenever Claude ran, not only when the Claude step succeeded", () => {
	const header = stepHeader(STEP);
	assert.equal(header.if, "steps.gate.outputs.run_claude == 'true'");
	assert.deepEqual(header.env, {
		EXECUTION_FILE: expression("steps.claude.outputs.execution_file"),
		CLAUDE_OUTCOME: expression("steps.claude.outcome"),
	});
});

test("the step follows the Claude step inside the analyze job", () => {
	const analyze = jobLine("analyze");
	const comment = jobLine("comment");
	const claude = stepLine("Run Claude advisory analysis");
	const summary = stepLine(STEP);
	assert.ok(analyze < claude && claude < summary && summary < comment);
});

test("the Action's own report stays off so Claude's text never reaches the summary", () => {
	assert.match(WORKFLOW, /^\s+display_report: false$/m);
});

test("a run with an execution file lands as a model table in the step summary", {
	skip,
}, () => {
	const run = runStep({ execution: EXECUTION, outcome: "success" });
	assert.equal(run.status, 0, run.stderr);
	assert.match(run.summary, /^## Claude advisory analysis$/m);
	assert.match(run.summary, /^- Claude step outcome: success$/m);
	assert.match(run.summary, /^- Requested model: `claude-sonnet-5-5`$/m);
	assert.match(
		run.summary,
		/^\| `claude-sonnet-5-5` \(requested\) \| 1200 \|/m,
	);
	assert.match(run.summary, /^\| `claude-sonnet-5` \| 100 \|/m);
	assert.doesNotMatch(run.summary, /SECRET-ASSISTANT-TEXT/);
	assert.doesNotMatch(run.stdout + run.stderr, /SECRET-ASSISTANT-TEXT/);
});

test("a Claude step that failed before writing an execution file is still recorded", {
	skip,
}, () => {
	const run = runStep({ execution: undefined, outcome: "failure" });
	assert.equal(run.status, 0, run.stderr);
	assert.match(run.summary, /^## Claude advisory analysis$/m);
	assert.match(run.summary, /^- Claude step outcome: failure$/m);
	assert.match(run.summary, /^- No execution file: /m);
	// step の timeout でも execution file は無いので、原因の候補に入っていること
	assert.match(run.summary, /step timeout/);
});

test("a summary script failure still leaves the heading and the outcome in the summary", {
	skip: skipUnreadable,
}, () => {
	const run = runStep({
		execution: EXECUTION,
		outcome: "success",
		unreadable: true,
	});
	assert.equal(run.status, 0, run.stderr);
	assert.match(run.stdout, /::warning::could not summarize/);
	assert.match(run.summary, /^## Claude advisory analysis$/m);
	assert.match(run.summary, /^- Claude step outcome: success$/m);
	assert.match(
		run.summary,
		/^- Could not summarize the execution file; see the log of this step$/m,
	);
	assert.doesNotMatch(run.summary, /SECRET-ASSISTANT-TEXT/);
});

test("a broken execution file is reported in the summary without failing the step", {
	skip,
}, () => {
	const run = runStep({ execution: "not json", outcome: "failure" });
	assert.equal(run.status, 0, run.stderr);
	assert.match(run.summary, /^- Claude step outcome: failure$/m);
	assert.match(run.summary, /not a JSON message array/);
});
