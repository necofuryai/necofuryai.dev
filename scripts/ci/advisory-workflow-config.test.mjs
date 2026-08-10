import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const WORKFLOW_URLS = [
	new URL(
		"../../.github/workflows/dependabot-advisory-review.yml",
		import.meta.url,
	),
	new URL(
		"../../.github/workflows/advisory-canary-fixture.yml",
		import.meta.url,
	),
];

const EXPECTED_ARGS = [
	"--model claude-sonnet-5",
	"--effort high",
	"--max-turns 20",
	"--max-budget-usd 1.00",
	'--tools "Read,Glob,Grep"',
	"--permission-mode dontAsk",
	"--settings .github/claude/advisory-permissions.json",
];

function readWorkflow(url) {
	return readFileSync(url, "utf8");
}

function extractClaudeArgs(source) {
	const match = source.match(/^\s+claude_args: >-\n((?:\s+--[^\n]+\n?)+)/m);
	assert.ok(match, "claude_args block is missing");
	return match[1]
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

function extractActionPin(source) {
	const match = source.match(
		/uses: anthropics\/claude-code-action@([0-9a-f]{40})/,
	);
	assert.ok(match, "full-length Claude Code Action pin is missing");
	return match[1];
}

test("Claude advisory workflows share the constrained runtime configuration", () => {
	const sources = WORKFLOW_URLS.map(readWorkflow);
	const args = sources.map(extractClaudeArgs);
	const actionPins = sources.map(extractActionPin);

	assert.deepEqual(args[0], EXPECTED_ARGS);
	assert.deepEqual(args[1], EXPECTED_ARGS);
	assert.equal(actionPins[0], actionPins[1]);
});
