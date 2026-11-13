import assert from "node:assert/strict";
import { test } from "node:test";
import { icons as fa6Solid } from "@iconify-json/fa6-solid";
import { icons as materialSymbols } from "@iconify-json/material-symbols";
import { resolveIconData } from "../../src/utils/icon-data.mjs";

const set = (overrides) => ({
	prefix: "test",
	width: 24,
	height: 24,
	icons: { base: { body: "<path d='M0'/>" } },
	...overrides,
});

test("an icon takes the set's dimensions when it sets none of its own", () => {
	assert.deepEqual(resolveIconData(materialSymbols, "search"), {
		body: materialSymbols.icons.search.body,
		left: 0,
		top: 0,
		width: 24,
		height: 24,
	});
});

test("an icon keeps its own width over the set's", () => {
	// fa6-solid draws on a 512 box, and chevron-right is narrower than that
	assert.deepEqual(resolveIconData(fa6Solid, "chevron-right"), {
		body: fa6Solid.icons["chevron-right"].body,
		left: 0,
		top: 0,
		width: 320,
		height: 512,
	});
});

test("an alias resolves to its parent's body and dimensions", () => {
	// The theme switch uses radio-button-partial-outline, an alias in the set
	assert.equal(
		materialSymbols.aliases["radio-button-partial-outline"].parent,
		"radio-button-partial",
	);
	assert.deepEqual(
		resolveIconData(materialSymbols, "radio-button-partial-outline"),
		resolveIconData(materialSymbols, "radio-button-partial"),
	);
});

test("a nearer alias overrides what it inherits, through a chain", () => {
	const chained = set({
		icons: { base: { body: "<path/>", width: 20 } },
		aliases: {
			wide: { parent: "base", width: 30 },
			tall: { parent: "wide", width: 35, height: 40 },
		},
	});
	// tall's own width beats wide's, which beats the icon's
	assert.deepEqual(resolveIconData(chained, "tall"), {
		body: "<path/>",
		left: 0,
		top: 0,
		width: 35,
		height: 40,
	});
	assert.equal(resolveIconData(chained, "wide").width, 30);
});

test("a set without dimensions falls back to Iconify's 16x16 default", () => {
	assert.deepEqual(
		resolveIconData({ prefix: "test", icons: { a: { body: "<g/>" } } }, "a"),
		{ body: "<g/>", left: 0, top: 0, width: 16, height: 16 },
	);
});

test("an unknown name stops the build with the icon's full name", () => {
	assert.throws(
		() => resolveIconData(materialSymbols, "no-such-icon"),
		/Icon "material-symbols:no-such-icon" is not in the installed @iconify-json\/material-symbols set/,
	);
	// Names that Object.prototype carries are not icons either
	assert.throws(() => resolveIconData(set({}), "constructor"), /is not in/);
	assert.throws(() => resolveIconData(set({}), "toString"), /is not in/);
});

test("an alias to a missing parent stops the build", () => {
	assert.throws(
		() =>
			resolveIconData(set({ aliases: { lost: { parent: "gone" } } }), "lost"),
		/Icon "test:lost" is not in/,
	);
});

test("transformations stop the build instead of being dropped", () => {
	for (const key of ["rotate", "hFlip", "vFlip"]) {
		const value = key === "rotate" ? 1 : true;
		assert.throws(
			() =>
				resolveIconData(
					set({ aliases: { turned: { parent: "base", [key]: value } } }),
					"turned",
				),
			new RegExp(`Icon "test:turned" uses ${key}`),
		);
		assert.throws(
			() =>
				resolveIconData(
					set({ icons: { base: { body: "<path/>", [key]: value } } }),
					"base",
				),
			new RegExp(`Icon "test:base" uses ${key}`),
		);
	}
});

test("an alias cycle stops the build instead of looping", () => {
	const cyclic = set({
		icons: {},
		aliases: { a: { parent: "b" }, b: { parent: "a" } },
	});
	assert.throws(() => resolveIconData(cyclic, "a"), /alias chain longer than/);
});
