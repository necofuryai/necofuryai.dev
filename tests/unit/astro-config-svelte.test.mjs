import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// The Svelte options live inline in astro.config.mjs (see AGENTS.md, "Svelte
// configuration"). vite-plugin-svelte accepts `dynamicCompileOptions` only at
// the top level of that object; wrapped in `vitePlugin: {}` it is dropped with
// a warning that nobody reads on a green build, and the runes enforcement
// silently stops. This test pins the shape so the mistake fails CI instead.

const root = new URL("../../", import.meta.url);
const configPath = new URL("astro.config.mjs", root);

function findSvelteCall(node) {
	if (
		ts.isCallExpression(node) &&
		ts.isIdentifier(node.expression) &&
		node.expression.text === "svelte"
	) {
		return node;
	}
	return ts.forEachChild(node, findSvelteCall);
}

function propertyName(property) {
	return property.name && ts.isIdentifier(property.name)
		? property.name.text
		: undefined;
}

function svelteOptions() {
	const source = readFileSync(configPath, "utf8");
	const file = ts.createSourceFile(
		"astro.config.mjs",
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.JS,
	);
	const call = findSvelteCall(file);
	assert.ok(call, "astro.config.mjs must call svelte() in integrations");
	const [options] = call.arguments;
	assert.ok(
		options && ts.isObjectLiteralExpression(options),
		"svelte() must receive an inline options object literal",
	);
	return options.properties;
}

test("no svelte.config file shadows the inline Svelte options", () => {
	for (const name of [
		"svelte.config.js",
		"svelte.config.ts",
		"svelte.config.mjs",
		"svelte.config.mts",
	]) {
		assert.ok(
			!existsSync(new URL(name, root)),
			`${name} exists; the Svelte options belong inline in astro.config.mjs`,
		);
	}
});

test("svelte() disables the config file probe", () => {
	const configFile = svelteOptions().find(
		(property) => propertyName(property) === "configFile",
	);
	assert.ok(configFile, "svelte() must set configFile");
	assert.ok(
		ts.isPropertyAssignment(configFile) &&
			configFile.initializer.kind === ts.SyntaxKind.FalseKeyword,
		"configFile must be false so vite-plugin-svelte does not probe for a file",
	);
});

test("svelte() keeps dynamicCompileOptions at the top level", () => {
	const names = svelteOptions().map(propertyName);
	assert.ok(
		names.includes("dynamicCompileOptions"),
		"dynamicCompileOptions must be a direct property of the svelte() options",
	);
	assert.ok(
		!names.includes("vitePlugin"),
		"vitePlugin is ignored in inline options; do not wrap dynamicCompileOptions in it",
	);
});
