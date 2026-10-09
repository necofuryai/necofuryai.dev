import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(
	new URL("./summarize-advisory-execution.mjs", import.meta.url),
);

const REQUESTED = "claude-sonnet-5-5";
const HELPER = "claude-haiku-4-5-20251001";

function usage(overrides = {}) {
	return {
		inputTokens: 1200,
		outputTokens: 340,
		cacheReadInputTokens: 25000,
		cacheCreationInputTokens: 0,
		webSearchRequests: 0,
		costUSD: 0.0701,
		contextWindow: 1000000,
		maxOutputTokens: 64000,
		...overrides,
	};
}

// 実際の execution file と同じく、SDK message の配列を組み立てる。
// hostile な入力に影響されうる assistant の本文も入れ、summary に出ないことを確かめる。
// init や result を省くには null を渡す (undefined は既定値に置き換わるため)
function execution({
	init = { type: "system", subtype: "init", model: REQUESTED },
	result = {
		type: "result",
		subtype: "success",
		num_turns: 13,
		total_cost_usd: 0.0763,
		permission_denials: Array.from({ length: 8 }, () => ({})),
		modelUsage: {
			[REQUESTED]: usage(),
			[HELPER]: usage({ inputTokens: 300, outputTokens: 20, costUSD: 0.0062 }),
		},
	},
} = {}) {
	return [
		init,
		{
			type: "assistant",
			message: {
				role: "assistant",
				content: [
					{
						type: "text",
						text: "SECRET-ASSISTANT-TEXT must not reach summary",
					},
				],
			},
		},
		result,
	].filter(Boolean);
}

// outcome に null を渡すと引数を省く (undefined は既定値に置き換わるため)
function run(content, outcome = "success") {
	const dir = mkdtempSync(join(tmpdir(), "advisory-summary-"));
	try {
		const file = join(dir, "claude-execution-output.json");
		writeFileSync(
			file,
			typeof content === "string" ? content : JSON.stringify(content),
		);
		const args = [SCRIPT, file];
		if (outcome !== null) args.push(outcome);
		return spawnSync(process.execPath, args, { encoding: "utf8" });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function expectSummary(content, outcome) {
	const result = run(content, outcome);
	assert.equal(result.status, 0, `expected exit 0, stderr: ${result.stderr}`);
	assert.match(result.stdout, /^## Claude advisory analysis\n\n/);
	assert.ok(result.stdout.endsWith("\n\n"), "summary ends with a blank line");
	assert.doesNotMatch(result.stdout, /SECRET-ASSISTANT-TEXT/);
	return result.stdout;
}

test("a normal run lists the outcome, the requested model, the result, and every model used", () => {
	const out = expectSummary(execution());
	assert.match(out, /^- Claude step outcome: success$/m);
	assert.match(out, /^- Requested model: `claude-sonnet-5-5`$/m);
	assert.match(
		out,
		/^- Result: success, turns: 13, permission denials: 8, cost: \$0\.0763$/m,
	);
	assert.match(
		out,
		/^\| `claude-sonnet-5-5` \(requested\) \| 1200 \| 25000 \| 340 \| \$0\.0701 \|$/m,
	);
	assert.match(
		out,
		/^\| `claude-haiku-4-5-20251001` \| 300 \| 25000 \| 20 \| \$0\.0062 \|$/m,
	);
	assert.doesNotMatch(out, /does not appear in modelUsage/);
});

test("a run answered only by another model says the requested model is missing", () => {
	const out = expectSummary(
		execution({
			result: {
				type: "result",
				subtype: "success",
				num_turns: 5,
				total_cost_usd: 0.05,
				permission_denials: [],
				modelUsage: { "claude-sonnet-5": usage() },
			},
		}),
	);
	assert.match(
		out,
		/^\| `claude-sonnet-5` \| 1200 \| 25000 \| 340 \| \$0\.0701 \|$/m,
	);
	assert.doesNotMatch(out, /\(requested\)/);
	assert.match(out, /^The requested model does not appear in modelUsage\.$/m);
});

test("a failed Claude step with a result message still records what ran", () => {
	const out = expectSummary(
		execution({
			result: {
				type: "result",
				subtype: "error_max_turns",
				num_turns: 20,
				total_cost_usd: 0.9,
				permission_denials: [],
				modelUsage: { [REQUESTED]: usage() },
			},
		}),
		"failure",
	);
	assert.match(out, /^- Claude step outcome: failure$/m);
	assert.match(
		out,
		/^- Result: error_max_turns, turns: 20, permission denials: 0, cost: \$0\.9000$/m,
	);
});

test("missing init or result messages are named instead of failing", () => {
	const noResult = expectSummary(execution({ result: null }));
	assert.match(noResult, /^- Requested model: `claude-sonnet-5-5`$/m);
	assert.match(noResult, /^- Result: \(no result message\)$/m);

	const noInit = expectSummary(execution({ init: null }));
	assert.match(noInit, /^- Requested model: \(no init message\)$/m);
	assert.match(noInit, /^\| `claude-sonnet-5-5` \| 1200/m);
	assert.match(noInit, /does not appear in modelUsage/);
});

test("the first init and the last result win when the engine re-emits them", () => {
	const messages = execution();
	messages.splice(1, 0, {
		type: "system",
		subtype: "init",
		model: "claude-opus-5-5",
	});
	messages.push({
		type: "result",
		subtype: "success",
		num_turns: 1,
		total_cost_usd: 0.01,
		permission_denials: [],
		modelUsage: { [REQUESTED]: usage() },
	});
	const out = expectSummary(messages);
	assert.match(out, /^- Requested model: `claude-sonnet-5-5`$/m);
	assert.match(out, /^- Result: success, turns: 1,/m);
});

test("values that do not look like model ids, words, or numbers are replaced", () => {
	const hostileModel =
		"x | <img src=x onerror=alert(1)> | [link](https://e.invalid)";
	const out = expectSummary(
		execution({
			init: { type: "system", subtype: "init", model: "claude sonnet" },
			result: {
				type: "result",
				subtype: "success; DROP",
				num_turns: "13",
				total_cost_usd: "free",
				permission_denials: "none",
				modelUsage: {
					[hostileModel]: usage({ inputTokens: -1, costUSD: Number.NaN }),
				},
			},
		}),
		"ok!",
	);
	assert.match(out, /^- Claude step outcome: \(invalid\)$/m);
	assert.match(out, /^- Requested model: \(invalid\)$/m);
	assert.match(
		out,
		/^- Result: \(invalid\), turns: \(invalid\), permission denials: \(invalid\), cost: \(invalid\)$/m,
	);
	assert.match(
		out,
		/^\| \(invalid\) \| \(invalid\) \| 25000 \| 340 \| \(invalid\) \|$/m,
	);
	assert.doesNotMatch(out, /img|onerror|https:|DROP|claude sonnet/);
});

test("modelUsage that is missing or empty is named", () => {
	const missing = expectSummary(
		execution({
			result: { type: "result", subtype: "success", num_turns: 1 },
		}),
	);
	assert.match(
		missing,
		/^- Result: success, turns: 1, permission denials: \(invalid\), cost: \(invalid\)$/m,
	);
	assert.match(missing, /^- Models used: \(no modelUsage\)$/m);

	const empty = expectSummary(
		execution({
			result: {
				type: "result",
				subtype: "success",
				num_turns: 1,
				total_cost_usd: 0,
				permission_denials: [],
				modelUsage: {},
			},
		}),
	);
	assert.match(empty, /^- Models used: \(empty modelUsage\)$/m);
});

test("an unparseable execution file is reported in the summary with exit 0", () => {
	const out = expectSummary("not json");
	assert.match(out, /^- Claude step outcome: success$/m);
	assert.match(
		out,
		/^- Result: \(execution file is not a JSON message array\)$/m,
	);
	assert.match(expectSummary({ type: "result" }), /not a JSON message array/);
});

test("an omitted outcome is shown as unknown", () => {
	const out = expectSummary(execution(), null);
	assert.match(out, /^- Claude step outcome: \(unknown\)$/m);
});

test("a missing argument or an unreadable file exits 1 without a summary", () => {
	const noArgs = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
	assert.equal(noArgs.status, 1);
	assert.match(noArgs.stderr, /usage:/);
	assert.equal(noArgs.stdout, "");

	const unreadable = spawnSync(
		process.execPath,
		[SCRIPT, join(tmpdir(), "advisory-summary-does-not-exist.json"), "success"],
		{ encoding: "utf8" },
	);
	assert.equal(unreadable.status, 1);
	assert.match(unreadable.stderr, /cannot read execution file/);
	assert.equal(unreadable.stdout, "");
});
