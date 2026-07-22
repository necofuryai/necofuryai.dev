#!/usr/bin/env node
/**
 * Fixed renderer for the Dependabot advisory comment job.
 *
 * Usage: node scripts/ci/render-advisory-comment.mjs <base64-json-file> <out-body-file>
 *
 * Reads Claude's structured output (base64-encoded JSON), validates it against
 * a fixed schema, escapes every string for safe GitHub Markdown, and renders a
 * fixed Japanese template into the output body file. The rendered body starts
 * with the `<!-- claude-dependabot-advisory -->` marker used by the comment
 * upsert step.
 *
 * The input is untrusted LLM output. This script fails closed: any validation
 * failure exits non-zero and writes nothing. Nothing outside the validated
 * schema fields is ever interpolated into the template.
 */
import { readFileSync, statSync, writeFileSync } from "node:fs";

const MARKER = "<!-- claude-dependabot-advisory -->";
const MAX_DECODED_BYTES = 64 * 1024;
// Base64 expands 3 bytes to 4 characters; allow slack for padding and newlines.
const MAX_INPUT_FILE_BYTES = Math.ceil(MAX_DECODED_BYTES / 3) * 4 + 4096;
const MAX_STRING_BYTES = 2000;
const MAX_ARRAY_ITEMS = 10;

const STRING_FIELD = "update_impact";
const ARRAY_FIELDS = [
	"release_note_checks",
	"related_components",
	"human_followups",
];
const ALLOWED_KEYS = new Set([STRING_FIELD, ...ARRAY_FIELDS]);

// Bidi override and isolate characters (U+202A-U+202E, U+2066-U+2069).
const BIDI_RE = /[\u202a-\u202e\u2066-\u2069]/gu;
// C0 controls, DEL, C1 controls, and Unicode line/paragraph separators.
// Newlines are intentionally included: every entry must render single-line.
// biome-ignore lint/suspicious/noControlCharactersInRegex: this regex deliberately strips control characters from untrusted LLM output
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu;
// Zero-width space, inserted after "@" to break GitHub mentions.
const ZERO_WIDTH_SPACE = "\u200b";

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
	console.error(`render-advisory-comment: ${message}`);
	process.exit(1);
}

/**
 * @param {string} inputPath
 * @returns {Buffer}
 */
function readDecodedInput(inputPath) {
	let stat;
	try {
		stat = statSync(inputPath);
	} catch {
		fail(`cannot stat input file: ${inputPath}`);
	}
	if (!stat.isFile()) {
		fail("input path is not a regular file");
	}
	if (stat.size > MAX_INPUT_FILE_BYTES) {
		fail(`input file exceeds ${MAX_INPUT_FILE_BYTES} bytes`);
	}
	let raw;
	try {
		raw = readFileSync(inputPath, "utf8");
	} catch {
		fail(`cannot read input file: ${inputPath}`);
	}
	const compact = raw.replace(/[\t\n\r ]/gu, "");
	if (compact.length === 0) {
		fail("input file is empty");
	}
	if (compact.length % 4 !== 0 || !/^[+/0-9A-Za-z]+={0,2}$/u.test(compact)) {
		fail("input is not valid base64");
	}
	const decoded = Buffer.from(compact, "base64");
	if (decoded.toString("base64") !== compact) {
		fail("input is not canonical base64");
	}
	if (decoded.byteLength > MAX_DECODED_BYTES) {
		fail(`decoded input exceeds ${MAX_DECODED_BYTES} bytes`);
	}
	return decoded;
}

/**
 * @param {Buffer} decoded
 * @returns {unknown}
 */
function parseJson(decoded) {
	let text;
	try {
		// fatal: reject invalid UTF-8. ignoreBOM: keep a BOM so JSON.parse
		// rejects it instead of silently accepting a non-canonical payload.
		text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
			decoded,
		);
	} catch {
		fail("decoded input is not valid UTF-8");
	}
	try {
		return JSON.parse(text);
	} catch {
		fail("input is not valid JSON");
	}
}

/**
 * @param {string} field
 * @param {unknown} value
 * @returns {string}
 */
function validateString(field, value) {
	if (typeof value !== "string") {
		fail(`${field} must be a string`);
	}
	if (Buffer.byteLength(value, "utf8") > MAX_STRING_BYTES) {
		fail(`${field} exceeds ${MAX_STRING_BYTES} UTF-8 bytes`);
	}
	return value;
}

/**
 * @param {unknown} parsed
 * @returns {{
 * 	update_impact: string,
 * 	release_note_checks: string[],
 * 	related_components: string[],
 * 	human_followups: string[],
 * }}
 */
function validateShape(parsed) {
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		fail("top-level value must be a JSON object");
	}
	for (const key of Object.keys(parsed)) {
		if (!ALLOWED_KEYS.has(key)) {
			fail(`unknown top-level key: ${JSON.stringify(key.slice(0, 64))}`);
		}
	}
	for (const field of ALLOWED_KEYS) {
		if (!Object.hasOwn(parsed, field)) {
			fail(`missing required field: ${field}`);
		}
	}
	const record = /** @type {Record<string, unknown>} */ (parsed);
	const result = {
		update_impact: validateString(STRING_FIELD, record[STRING_FIELD]),
	};
	for (const field of ARRAY_FIELDS) {
		const value = record[field];
		if (!Array.isArray(value)) {
			fail(`${field} must be an array`);
		}
		if (value.length > MAX_ARRAY_ITEMS) {
			fail(`${field} exceeds ${MAX_ARRAY_ITEMS} items`);
		}
		result[field] = value.map((item, index) =>
			validateString(`${field}[${index}]`, item),
		);
	}
	return result;
}

/**
 * Escape one validated string for safe interpolation into GitHub Markdown.
 * The result is a single line with HTML, Markdown links, code spans, table
 * pipes, and @mentions neutralized.
 *
 * @param {string} value
 * @returns {string}
 */
function escapeMarkdown(value) {
	return (
		value
			.replace(BIDI_RE, "")
			.replace(CONTROL_RE, "")
			// Escape backslash first so later backslash escapes cannot be undone.
			.replaceAll("\\", "\\\\")
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;")
			.replaceAll("`", "\\`")
			.replaceAll("|", "\\|")
			.replaceAll("[", "\\[")
			.replaceAll("]", "\\]")
			.replaceAll("(", "\\(")
			.replaceAll(")", "\\)")
			// Break @mentions with a zero-width space so GitHub never notifies.
			.replaceAll("@", `@${ZERO_WIDTH_SPACE}`)
	);
}

/**
 * @param {string[]} items
 * @returns {string}
 */
function renderItems(items) {
	if (items.length === 0) {
		return "なし";
	}
	return items.map((item) => `- ${escapeMarkdown(item)}`).join("\n");
}

/**
 * @param {ReturnType<typeof validateShape>} data
 * @returns {string}
 */
function renderBody(data) {
	const impact = escapeMarkdown(data.update_impact);
	return [
		MARKER,
		"",
		"## 依存関係更新に関する参考情報 (Claude advisory)",
		"",
		"### 更新影響",
		"",
		impact === "" ? "なし" : impact,
		"",
		"### リリースノートで確認すべき点",
		"",
		renderItems(data.release_note_checks),
		"",
		"### 関連コンポーネントの候補",
		"",
		renderItems(data.related_components),
		"",
		"### 人間の確認事項",
		"",
		renderItems(data.human_followups),
		"",
		"---",
		"",
		"このコメントは、依存関係更新の参考情報だけを提供する自動投稿 (advisory-only) です。チェック結果を変更することはなく、マージ可否の判断にも使われません。",
		"",
	].join("\n");
}

function main() {
	const args = process.argv.slice(2);
	if (args.length !== 2) {
		fail(
			"usage: node scripts/ci/render-advisory-comment.mjs <base64-json-file> <out-body-file>",
		);
	}
	const [inputPath, outputPath] = args;
	const decoded = readDecodedInput(inputPath);
	const parsed = parseJson(decoded);
	const data = validateShape(parsed);
	const body = renderBody(data);
	try {
		writeFileSync(outputPath, body, { encoding: "utf8" });
	} catch {
		fail(`cannot write output file: ${outputPath}`);
	}
}

main();
