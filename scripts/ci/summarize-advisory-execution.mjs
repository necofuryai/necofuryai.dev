// Claude Code Action の execution file から、どのモデルが応答したかを step summary 用の Markdown に
// して stdout へ書く。
// 使い方: node scripts/ci/summarize-advisory-execution.mjs <execution-file> [claude-step-outcome]
//
// Sonnet 5.5 は分類器に flag されると Sonnet 5 で再実行され、Claude の step はその場合も success で
// 終わる。result message の modelUsage を見ないと切り替わりに気付けないので、run の step summary に
// 残す。summary は run を開ける人なら誰でも読め、execution file には untrusted な入力に影響された
// assistant の本文やツール結果が含まれるので、出すのはモデル ID、result の種別、turn 数、費用、
// permission denial の件数だけとし、どれも形式を確かめてから書く。形式に合わない値は固定の文字列に
// 置き換える。
// execution file の中身の不備は summary の本文として報告し、exit 0 で終わる (analyze job を落とさない)。
// exit 1 は引数が無いか、ファイルが読めないときだけ。
import { readFileSync } from "node:fs";

// 一次配布のモデル ID (claude-sonnet-5-5、claude-haiku-4-5-20251001) と `[1m]` 付きの ID を通す
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._@:[\]-]{0,99}$/;
const WORD = /^[a-z_]+$/;
const INVALID = "(invalid)";

function word(value) {
	return typeof value === "string" && WORD.test(value) ? value : INVALID;
}

function modelId(value) {
	return typeof value === "string" && MODEL_ID.test(value)
		? `\`${value}\``
		: INVALID;
}

function count(value) {
	return Number.isInteger(value) && value >= 0 ? String(value) : INVALID;
}

function usd(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? `$${value.toFixed(4)}`
		: INVALID;
}

function isMessage(value) {
	return value !== null && typeof value === "object";
}

const [executionFile, outcome] = process.argv.slice(2);
if (!executionFile) {
	console.error(
		"usage: summarize-advisory-execution.mjs <execution-file> [claude-step-outcome]",
	);
	process.exit(1);
}

let raw;
try {
	raw = readFileSync(executionFile, "utf8");
} catch (error) {
	console.error(`cannot read execution file: ${error.message}`);
	process.exit(1);
}

const lines = ["## Claude advisory analysis", ""];
lines.push(
	`- Claude step outcome: ${outcome === undefined ? "(unknown)" : word(outcome)}`,
);

function summarize(messages) {
	// init は engine が再送することがあるので最初のものを、result は最後のものを使う
	const init = messages.find(
		(message) =>
			isMessage(message) &&
			message.type === "system" &&
			message.subtype === "init",
	);
	const result = messages
		.filter((message) => isMessage(message) && message.type === "result")
		.at(-1);
	const requested = init?.model;
	lines.push(
		`- Requested model: ${init ? modelId(requested) : "(no init message)"}`,
	);
	if (!result) {
		lines.push("- Result: (no result message)");
		return;
	}
	const denials = Array.isArray(result.permission_denials)
		? result.permission_denials.length
		: undefined;
	lines.push(
		`- Result: ${word(result.subtype)}, turns: ${count(result.num_turns)}, permission denials: ${count(denials)}, cost: ${usd(result.total_cost_usd)}`,
	);

	const usage = result.modelUsage;
	if (!isMessage(usage) || Array.isArray(usage)) {
		lines.push("- Models used: (no modelUsage)");
		return;
	}
	const entries = Object.entries(usage);
	if (entries.length === 0) {
		lines.push("- Models used: (empty modelUsage)");
		return;
	}
	lines.push(
		"",
		"| Model | Input tokens | Cache read tokens | Output tokens | Cost |",
		"|---|---:|---:|---:|---:|",
	);
	let requestedSeen = false;
	for (const [model, stats] of entries) {
		const isRequested = typeof requested === "string" && model === requested;
		requestedSeen ||= isRequested;
		const label = `${modelId(model)}${isRequested ? " (requested)" : ""}`;
		lines.push(
			`| ${label} | ${count(stats?.inputTokens)} | ${count(stats?.cacheReadInputTokens)} | ${count(stats?.outputTokens)} | ${usd(stats?.costUSD)} |`,
		);
	}
	if (!requestedSeen) {
		lines.push("", "The requested model does not appear in modelUsage.");
	}
}

let messages;
try {
	messages = JSON.parse(raw);
} catch {
	messages = undefined;
}
if (Array.isArray(messages)) {
	summarize(messages);
} else {
	lines.push("- Result: (execution file is not a JSON message array)");
}

process.stdout.write(`${lines.join("\n")}\n\n`);
