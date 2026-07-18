// Claude Code Action の execution file から最後の assistant テキストを取り出し、
// その中の単一 JSON object を検証可能な形で stdout へ base64 出力する。
// 使い方: node scripts/ci/extract-advisory-json.mjs <execution-file>
// 失敗はすべて exit 1 (advisory を skip させる fail-closed)。
import { readFileSync } from "node:fs";

const MAX_OUTPUT_BYTES = 65536;

function collectAssistantTexts(node, out) {
	if (node == null) return;
	if (Array.isArray(node)) {
		for (const item of node) collectAssistantTexts(item, out);
		return;
	}
	if (typeof node !== "object") return;
	const role = node.role ?? node.type;
	if (role === "assistant") {
		const content = node.content ?? node.message?.content;
		if (typeof content === "string") out.push(content);
		if (Array.isArray(content)) {
			for (const block of content) {
				if (block && block.type === "text" && typeof block.text === "string") {
					out.push(block.text);
				}
			}
		}
	}
	for (const value of Object.values(node)) collectAssistantTexts(value, out);
}

const file = process.argv[2];
if (!file) {
	console.error("usage: extract-advisory-json.mjs <execution-file>");
	process.exit(1);
}

let parsed;
try {
	parsed = JSON.parse(readFileSync(file, "utf8"));
} catch {
	console.error("execution file is not valid JSON");
	process.exit(1);
}

const texts = [];
collectAssistantTexts(parsed, texts);
if (texts.length === 0) {
	console.error("no assistant text found");
	process.exit(1);
}

const last = texts[texts.length - 1];
const start = last.indexOf("{");
const end = last.lastIndexOf("}");
if (start < 0 || end <= start) {
	console.error("no JSON object in final assistant text");
	process.exit(1);
}
const candidate = last.slice(start, end + 1);
let advisory;
try {
	advisory = JSON.parse(candidate);
} catch {
	console.error("final assistant text is not a single JSON object");
	process.exit(1);
}

const normalized = JSON.stringify(advisory);
if (Buffer.byteLength(normalized, "utf8") > MAX_OUTPUT_BYTES) {
	console.error("advisory JSON exceeds size limit");
	process.exit(1);
}
process.stdout.write(Buffer.from(normalized, "utf8").toString("base64"));
