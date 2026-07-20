import assert from "node:assert/strict";
import { test } from "node:test";
import { rehypeSponsoredLinks } from "../../src/plugins/rehype-sponsored-links.mjs";

function link(href) {
	return {
		type: "element",
		tagName: "a",
		properties: { href },
		children: [],
	};
}

function run(tree, options) {
	rehypeSponsoredLinks(options)(tree);
	return tree;
}

test("adds sponsored rel and target to links on configured domains", () => {
	const tree = {
		type: "root",
		children: [link("https://app.usespeak.com/jp-ja/i/LGZDMD")],
	};
	run(tree, { domains: ["app.usespeak.com"] });
	assert.deepEqual(tree.children[0].properties.rel, [
		"sponsored",
		"nofollow",
		"noopener",
	]);
	assert.equal(tree.children[0].properties.target, "_blank");
});

test("leaves other external links untouched", () => {
	const tree = { type: "root", children: [link("https://example.com/")] };
	run(tree, { domains: ["app.usespeak.com"] });
	assert.equal(tree.children[0].properties.rel, undefined);
	assert.equal(tree.children[0].properties.target, undefined);
});

test("leaves relative links untouched", () => {
	const tree = { type: "root", children: [link("/about/")] };
	run(tree, { domains: ["app.usespeak.com"] });
	assert.equal(tree.children[0].properties.rel, undefined);
});

test("ignores anchors without href", () => {
	const tree = {
		type: "root",
		children: [{ type: "element", tagName: "a", properties: {}, children: [] }],
	};
	run(tree, { domains: ["app.usespeak.com"] });
	assert.equal(tree.children[0].properties.rel, undefined);
});

test("leaves mailto links untouched", () => {
	const tree = {
		type: "root",
		children: [link("mailto:someone@example.com")],
	};
	run(tree, { domains: ["app.usespeak.com"] });
	assert.equal(tree.children[0].properties.rel, undefined);
	assert.equal(tree.children[0].properties.target, undefined);
});

test("matches configured domains regardless of case", () => {
	const tree = {
		type: "root",
		children: [link("https://app.usespeak.com/jp-ja/i/LGZDMD")],
	};
	run(tree, { domains: ["App.Usespeak.com"] });
	assert.deepEqual(tree.children[0].properties.rel, [
		"sponsored",
		"nofollow",
		"noopener",
	]);
	assert.equal(tree.children[0].properties.target, "_blank");
});
