import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

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

const RENDERER = fileURLToPath(
	new URL("./render-advisory-comment.mjs", import.meta.url),
);

// schema が許す出力は、comment job の render-advisory-comment.mjs がすべて受け付けなければならない。
// 片方だけを変えると、形の正しい出力が comment job で落ちるので、最後のテストで突き合わせる。
// maxLength は文字数で数える。500 文字は UTF-8 で最大 2,000 byte なので、renderer の上限を超えない
const ADVISORY_STRING = { type: "string", maxLength: 500 };
const ADVISORY_ARRAY = { type: "array", maxItems: 10, items: ADVISORY_STRING };
const ADVISORY_SCHEMA = {
	type: "object",
	properties: {
		update_impact: ADVISORY_STRING,
		release_note_checks: ADVISORY_ARRAY,
		related_components: ADVISORY_ARRAY,
		human_followups: ADVISORY_ARRAY,
	},
	required: [
		"update_impact",
		"release_note_checks",
		"related_components",
		"human_followups",
	],
	additionalProperties: false,
};

const EXPECTED_ARGS = [
	"--model claude-sonnet-5-5",
	"--effort high",
	"--max-turns 20",
	"--max-budget-usd 1.00",
	'--tools "Read,Glob,Grep"',
	"--permission-mode dontAsk",
	"--settings .github/claude/advisory-permissions.json",
	`--json-schema '${JSON.stringify(ADVISORY_SCHEMA)}'`,
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

// schema が許す最大の出力。U+1F600 は UTF-8 で 4 byte なので、maxLength 文字並べた文字列が最も重い
function largestSchemaOutput() {
	const fill = (schema) =>
		String.fromCodePoint(0x1f600).repeat(schema.maxLength);
	return Object.fromEntries(
		ADVISORY_SCHEMA.required.map((key) => {
			const property = ADVISORY_SCHEMA.properties[key];
			return [
				key,
				property.type === "array"
					? Array.from({ length: property.maxItems }, () =>
							fill(property.items),
						)
					: fill(property),
			];
		}),
	);
}

test("the comment renderer accepts the largest output the --json-schema allows", () => {
	const dir = mkdtempSync(join(tmpdir(), "advisory-schema-"));
	try {
		const input = join(dir, "input.b64");
		writeFileSync(
			input,
			Buffer.from(JSON.stringify(largestSchemaOutput()), "utf8").toString(
				"base64",
			),
		);
		const result = spawnSync(
			process.execPath,
			[RENDERER, input, join(dir, "body.md")],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 0, result.stderr);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
