import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(
	new URL("./render-advisory-comment.mjs", import.meta.url),
);
const MARKER = "<!-- claude-dependabot-advisory -->";

// Dangerous characters are built at runtime so this test source stays ASCII.
const BS = String.fromCharCode(92); // backslash
const NUL = String.fromCharCode(0);
const ESC = String.fromCharCode(27);
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const RLO = String.fromCodePoint(0x202e); // right-to-left override
const LRI = String.fromCodePoint(0x2066); // left-to-right isolate
const PDI = String.fromCodePoint(0x2069); // pop directional isolate
const ZWSP = String.fromCodePoint(0x200b); // zero-width space

function validPayload(overrides = {}) {
	return {
		update_impact: "patch 更新で、破壊的変更は見当たらない。",
		release_note_checks: ["CHANGELOG の 1.2.3 節を確認する"],
		related_components: ["src/components/Navbar.astro"],
		human_followups: [],
		...overrides,
	};
}

function run(payload, options = {}) {
	const dir = mkdtempSync(join(tmpdir(), "advisory-render-"));
	const inputFile = join(dir, "input.b64");
	const outFile = join(dir, "body.md");
	const json = options.rawJson ?? JSON.stringify(payload);
	const base64 =
		options.rawBase64 ?? Buffer.from(json, "utf8").toString("base64");
	writeFileSync(inputFile, base64, "utf8");
	const result = spawnSync(process.execPath, [SCRIPT, inputFile, outFile], {
		encoding: "utf8",
	});
	return { result, outFile };
}

function renderOk(payload) {
	const { result, outFile } = run(payload);
	assert.equal(result.status, 0, `expected success, stderr: ${result.stderr}`);
	return readFileSync(outFile, "utf8");
}

function expectRejected(payload, options = {}) {
	const { result, outFile } = run(payload, options);
	assert.notEqual(result.status, 0, "expected a non-zero exit code");
	assert.ok(!existsSync(outFile), "output file must not exist on failure");
	return result;
}

test("valid input renders the fixed template with the marker first", () => {
	const body = renderOk(validPayload());
	assert.ok(body.startsWith(MARKER + LF), "marker must be the first line");
	assert.ok(body.includes("### 更新影響"));
	assert.ok(body.includes("patch 更新で、破壊的変更は見当たらない。"));
	assert.ok(body.includes("### リリースノートで確認すべき点"));
	assert.ok(body.includes("- CHANGELOG の 1.2.3 節を確認する"));
	assert.ok(body.includes("- src/components/Navbar.astro"));
	assert.ok(body.includes("チェック結果を変更することはなく"), "footer");
});

test("empty arrays render as なし", () => {
	const body = renderOk(validPayload());
	assert.ok(body.includes(`### 関連コンポーネントの候補${LF}${LF}`));
	assert.ok(body.includes(`### 人間の確認事項${LF}${LF}なし`));
});

test("rejects a field exceeding 2000 UTF-8 bytes", () => {
	expectRejected(validPayload({ update_impact: "x".repeat(2001) }));
	// 667 three-byte characters = 2001 UTF-8 bytes.
	expectRejected(validPayload({ human_followups: ["あ".repeat(667)] }));
});

test("rejects input whose decoded size exceeds 64 KiB", () => {
	expectRejected(
		validPayload({
			oversized_unknown_field: "y".repeat(70 * 1024),
		}),
	);
});

test("rejects unknown top-level keys", () => {
	expectRejected(validPayload({ verdict: "auto-merge ok" }));
});

test("rejects a missing required field", () => {
	const payload = validPayload();
	delete payload.human_followups;
	expectRejected(payload);
});

test("rejects arrays with more than 10 items", () => {
	expectRejected(
		validPayload({
			release_note_checks: Array.from({ length: 11 }, () => "a"),
		}),
	);
});

test("rejects non-string values", () => {
	expectRejected(validPayload({ update_impact: 42 }));
	expectRejected(validPayload({ related_components: [null] }));
	expectRejected(validPayload({ human_followups: "not an array" }));
});

test("rejects non-object top-level values", () => {
	expectRejected(null, { rawJson: "[]" });
	expectRejected(null, { rawJson: "null" });
	expectRejected(null, { rawJson: '"string"' });
});

test("rejects input that is not valid base64", () => {
	expectRejected(null, { rawBase64: "not base64!!!" });
});

test("rejects base64 that does not decode to valid UTF-8", () => {
	const invalidUtf8 = Buffer.from([0xff, 0xfe, 0x00, 0x01]).toString("base64");
	expectRejected(null, { rawBase64: invalidUtf8 });
});

test("rejects input that is not valid JSON", () => {
	expectRejected(null, { rawJson: "{" });
});

test("rejects wrong argument count", () => {
	const result = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
	assert.notEqual(result.status, 0);
});

test("strips control characters and keeps each entry single-line", () => {
	const body = renderOk(
		validPayload({
			human_followups: [`第一行${CR}${LF}第二行${NUL}${ESC}止め`],
		}),
	);
	assert.ok(!body.includes(NUL), "NUL must be stripped");
	assert.ok(!body.includes(ESC), "ESC must be stripped");
	assert.ok(!body.includes(CR), "CR must be stripped");
	assert.ok(body.includes("- 第一行第二行"), "entry must collapse to one line");
});

test("removes bidi override and isolate characters", () => {
	const body = renderOk(
		validPayload({ update_impact: `abc${RLO}evil${LRI}x${PDI}` }),
	);
	for (let codePoint = 0x202a; codePoint <= 0x202e; codePoint += 1) {
		assert.ok(!body.includes(String.fromCodePoint(codePoint)));
	}
	for (let codePoint = 0x2066; codePoint <= 0x2069; codePoint += 1) {
		assert.ok(!body.includes(String.fromCodePoint(codePoint)));
	}
	assert.ok(body.includes("abcevilx"));
});

test("breaks @mentions with a zero-width space", () => {
	const body = renderOk(
		validPayload({ update_impact: "@necofuryai please approve" }),
	);
	assert.ok(!body.includes("@necofuryai"), "raw mention must not appear");
	assert.ok(body.includes(`@${ZWSP}necofuryai`));
});

test("neutralizes markdown link injection", () => {
	const injected = "[Click here](https://evil.example/payload)";
	const body = renderOk(validPayload({ release_note_checks: [injected] }));
	assert.ok(!body.includes(injected), "raw link must not appear");
	assert.ok(!body.includes("]("), "no unescaped link syntax anywhere");
	assert.ok(body.includes(`${BS}[Click here${BS}]${BS}(`));
});

test("escapes raw HTML", () => {
	const body = renderOk(
		validPayload({
			update_impact: "<script>alert(1)</script> <img src=x onerror=alert(1)>",
		}),
	);
	assert.ok(!body.includes("<script"), "raw script tag must not appear");
	assert.ok(!body.includes("<img"), "raw img tag must not appear");
	assert.ok(
		body.includes("&lt;script&gt;"),
		"angle brackets must be HTML-escaped",
	);
});

test("escapes backticks, pipes, and backslashes", () => {
	const BT = String.fromCharCode(96); // backtick
	const input = `run ${BS}x ${BT}rm -rf${BS}${BT} | sh`;
	const body = renderOk(validPayload({ update_impact: input }));
	assert.ok(body.includes(`${BS}${BS}x`), "backslash must be doubled");
	assert.ok(body.includes(`${BS}${BT}rm -rf`), "backticks must be escaped");
	assert.ok(body.includes(`${BS}|`), "pipes must be escaped");
});
