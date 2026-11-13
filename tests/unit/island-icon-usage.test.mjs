import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "svelte/compiler";

// @iconify/svelte fetches an icon from the Iconify API in the visitor's
// browser when `icon` is a name, and renders icon data it is given without any
// request, so the islands receive their icons as build-time data (AGENTS.md,
// "Icons"). The prop is typed `IconifyIcon | string` and nothing type-checks
// .svelte files, so a name compiles, and the UI tests see the request it causes
// only for an icon they render. This test reads the sources instead and fails
// on the forms that bring the request back: a string that can become `icon`,
// an `icon` hidden in a spread, and any use of the package beyond its `Icon`
// component and types. A name held in a variable or returned by a function
// still passes and is left to the UI tests.

const MODULE = "@iconify/svelte";
const root = fileURLToPath(new URL("../../", import.meta.url));
const srcDir = join(root, "src");

// A static or dynamic import, a side-effect import, or a re-export of the
// package or one of its subpaths, as written in a file that is not .svelte
const MODULE_REFERENCE =
	/\b(?:from|import)\s*\(?\s*["']@iconify\/svelte(?:\/[^"']*)?["']/;

const isIconifyModule = (value) =>
	typeof value === "string" &&
	(value === MODULE || value.startsWith(`${MODULE}/`));

function walk(node, visit) {
	if (Array.isArray(node)) {
		for (const child of node) walk(child, visit);
		return;
	}
	if (node === null || typeof node !== "object") return;
	if (typeof node.type === "string") visit(node);
	for (const [key, child] of Object.entries(node)) {
		if (key !== "parent" && key !== "metadata") walk(child, visit);
	}
}

// The string literals that can end up as the value of an expression. A string
// elsewhere, such as the test of a conditional or a computed key, cannot.
function valueStrings(node) {
	switch (node?.type) {
		case "Literal":
			return typeof node.value === "string" ? [node] : [];
		case "TemplateLiteral":
			return [node];
		case "ConditionalExpression":
			return [
				...valueStrings(node.consequent),
				...valueStrings(node.alternate),
			];
		case "LogicalExpression":
			return [...valueStrings(node.left), ...valueStrings(node.right)];
		case "BinaryExpression":
			// Only `+` can make a string; a comparison makes a boolean
			return node.operator === "+"
				? [...valueStrings(node.left), ...valueStrings(node.right)]
				: [];
		case "SequenceExpression":
			return valueStrings(node.expressions.at(-1));
		case "ParenthesizedExpression":
		case "TSAsExpression":
		case "TSSatisfiesExpression":
		case "TSNonNullExpression":
			return valueStrings(node.expression);
		default:
			return [];
	}
}

function checkSvelte(source, file) {
	const ast = parse(source, { filename: file, modern: true });
	const at = (node) =>
		`${file}:${source.slice(0, node.start).split("\n").length}`;
	const problems = [];
	const components = new Set();
	for (const script of [ast.module, ast.instance]) {
		if (!script) continue;
		walk(script.content, (node) => {
			if (node.type === "ImportDeclaration") {
				if (!isIconifyModule(node.source.value) || node.importKind === "type")
					return;
				for (const specifier of node.specifiers) {
					if (specifier.type === "ImportDefaultSpecifier") {
						components.add(specifier.local.name);
					} else if (specifier.importKind !== "type") {
						problems.push(
							`${at(specifier)}: imports ${specifier.local.name} from ${node.source.value}; take only the default Icon component and types from it`,
						);
					}
				}
			} else if (isIconifyModule(node.source?.value)) {
				problems.push(
					`${at(node)}: ${node.type} of ${node.source.value}; import only its Icon component and types, statically`,
				);
			}
		});
	}
	let usages = 0;
	walk(ast.fragment, (node) => {
		if (node.type !== "Component" || !components.has(node.name)) return;
		usages += 1;
		if (
			node.attributes.some((attribute) => attribute.type === "SpreadAttribute")
		) {
			problems.push(
				`${at(node)}: <${node.name}> takes a spread, which can carry an icon name; pass icon={…} on its own`,
			);
		}
		const icon = node.attributes.find(
			(attribute) =>
				attribute.type === "Attribute" && attribute.name === "icon",
		);
		if (!icon) {
			problems.push(`${at(node)}: <${node.name}> has no icon attribute`);
		} else if (icon.value === true || Array.isArray(icon.value)) {
			problems.push(
				`${at(icon)}: <${node.name}> gets icon as a string; pass resolved icon data, as in icon={icons.…}`,
			);
		} else {
			for (const string of valueStrings(icon.value.expression)) {
				problems.push(
					`${at(string)}: <${node.name}> can get icon as the string ${source.slice(string.start, string.end)}; pass resolved icon data`,
				);
			}
		}
	});
	return { problems, usages };
}

function sourceFiles() {
	return readdirSync(srcDir, { recursive: true })
		.map((path) => join(srcDir, path))
		.filter((path) => /\.(?:astro|svelte|[cm]?[jt]s)$/.test(path))
		.map((path) => ({
			file: relative(root, path),
			source: readFileSync(path, "utf8"),
		}));
}

const lines = (problems) =>
	problems.map((problem) => Number(problem.match(/:(\d+): /)[1]));

test("every Icon under src/ receives icon data, never a name", () => {
	const problems = [];
	let usages = 0;
	for (const { file, source } of sourceFiles()) {
		if (!file.endsWith(".svelte")) continue;
		const result = checkSvelte(source, file);
		problems.push(...result.problems);
		usages += result.usages;
	}
	assert.deepEqual(problems, []);
	// The islands render Icon, so finding none means the scan itself broke
	assert.ok(usages > 0, "found no Icon from @iconify/svelte under src/");
});

test("only .svelte files under src/ import @iconify/svelte", () => {
	const offenders = sourceFiles()
		.filter(
			({ file, source }) =>
				!file.endsWith(".svelte") && MODULE_REFERENCE.test(source),
		)
		.map(({ file }) => file);
	assert.deepEqual(offenders, []);
});

test("the reference pattern matches imports of the package, not mentions of it", () => {
	for (const reference of [
		'import Icon from "@iconify/svelte";',
		"const m = await import('@iconify/svelte/dist/functions');",
		'export { loadIcon } from "@iconify/svelte";',
		'import "@iconify/svelte";',
	]) {
		assert.ok(MODULE_REFERENCE.test(reference), reference);
	}
	assert.equal(
		MODULE_REFERENCE.test("// @iconify/svelte fetches the icon"),
		false,
	);
});

test("the check reports each form that can pass a name", () => {
	const source = [
		'<script lang="ts">',
		'import Iconify, { loadIcon, type IconifyIcon } from "@iconify/svelte";',
		'const load = () => import("@iconify/svelte/dist/functions");',
		"let { icons, name, rest }: { icons: Record<string, IconifyIcon>; name: string; rest: object } = $props();",
		"</script>",
		'<Iconify icon="mdi:home" />',
		'<Iconify icon={"mdi:home"} />',
		// biome-ignore lint/suspicious/noTemplateCurlyInString: Svelte source holding a template literal
		"{#if name}<Iconify icon={`mdi:${name}`} />{/if}",
		'{#each [1] as _}<Iconify icon={name ? "mdi:a" : icons.a} />{/each}',
		'<Iconify icon={icons.a ?? "mdi:fallback"} />',
		'<Iconify icon={"mdi:" + name} />',
		"<Iconify {...rest} />",
	].join("\n");
	const { problems, usages } = checkSvelte(source, "Fixture.svelte");
	assert.equal(usages, 7);
	assert.deepEqual(lines(problems), [2, 3, 6, 7, 8, 9, 10, 11, 12, 12]);
});

test("the check accepts icon data wherever the expression only selects it", () => {
	const source = [
		'<script lang="ts">',
		'import Icon, { type IconifyIcon } from "@iconify/svelte";',
		'import type { IconifyIconProps } from "@iconify/svelte";',
		"let { icons, mode }: { icons: Record<string, IconifyIcon>; mode: string } = $props();",
		"</script>",
		'<Icon icon={icons.light} class="text-[1.25rem]" />',
		'<Icon icon={icons["dark"]} />',
		'<Icon icon={mode === "dark" ? icons.dark : icons.light} />',
		"<Icon icon={(icons[mode] as IconifyIcon)} />",
		'<Icon icon={(mode === "dark" && icons.dark) || icons.light} />',
	].join("\n");
	assert.deepEqual(checkSvelte(source, "Fixture.svelte"), {
		problems: [],
		usages: 5,
	});
});
