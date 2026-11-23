import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// Cloudflare Workers Static Assets の配信設定 (wrangler.jsonc と public/_headers) は
// Astro のビルドやローカルの pnpm preview では検証されない。workers.dev からの重複配信、
// 404 のソフト 404 化、末尾スラッシュの不一致、意図しない X-Robots-Tag による検索除外、
// HSTS の欠落を防ぐため、設定ファイルの不変条件をここで固定する。
const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

function readWranglerConfig() {
	const { config, error } = ts.parseConfigFileTextToJson(
		"wrangler.jsonc",
		read("wrangler.jsonc"),
	);
	assert.equal(error, undefined, "wrangler.jsonc must be valid JSONC");
	assert.ok(
		config && typeof config === "object",
		"wrangler.jsonc must parse to an object",
	);
	return config;
}

function parseHeadersFile(source) {
	const rules = new Map();
	let currentPath = null;
	for (const rawLine of source.split(/\r?\n/)) {
		const trimmed = rawLine.trim();
		if (trimmed === "" || trimmed.startsWith("#")) continue;
		if (/^\s/.test(rawLine)) {
			assert.notEqual(
				currentPath,
				null,
				`header line without a path block: ${trimmed}`,
			);
			if (trimmed.startsWith("!")) continue;
			const separator = trimmed.indexOf(":");
			assert.ok(separator > 0, `malformed header line: ${trimmed}`);
			rules.get(currentPath).push({
				name: trimmed.slice(0, separator).trim(),
				value: trimmed.slice(separator + 1).trim(),
			});
		} else {
			currentPath = trimmed;
			if (!rules.has(currentPath)) {
				rules.set(currentPath, []);
			}
		}
	}
	return rules;
}

test("wrangler.jsonc disables workers.dev and aligns static asset routing with canonical URLs", () => {
	const config = readWranglerConfig();
	assert.equal(
		config.workers_dev,
		false,
		"workers_dev must stay false so *.workers.dev does not mirror the custom domain",
	);
	assert.equal(
		config.assets?.not_found_handling,
		"404-page",
		"missing paths must serve 404.html with HTTP 404",
	);
	assert.equal(
		config.assets?.html_handling,
		"force-trailing-slash",
		"HTML paths must normalize to trailing slashes to match Astro's trailingSlash: always",
	);
});

test("public/_headers sets HSTS site-wide and emits no X-Robots-Tag", () => {
	const rules = parseHeadersFile(read("public/_headers"));
	const rootHeaders = rules.get("/*") ?? [];
	const hstsHeaders = rootHeaders.filter(
		(header) => header.name.toLowerCase() === "strict-transport-security",
	);
	assert.equal(
		hstsHeaders.length,
		1,
		"/* must declare exactly one Strict-Transport-Security header",
	);
	assert.match(
		hstsHeaders[0].value,
		/\bmax-age=[1-9]\d*\b/,
		"Strict-Transport-Security must specify a positive max-age",
	);

	const robotsHeaders = [...rules.entries()].flatMap(([path, headers]) =>
		headers
			.filter((header) => header.name.toLowerCase() === "x-robots-tag")
			.map((header) => `${path}: ${header.name}: ${header.value}`),
	);
	assert.deepEqual(
		robotsHeaders,
		[],
		"public/_headers must not emit X-Robots-Tag headers that could block indexing",
	);
});
