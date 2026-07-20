import assert from "node:assert/strict";
import { test } from "node:test";
import { renderFeedContent } from "../../src/utils/rss-content.mjs";

test("adds sponsored rel and target to sponsored-domain links", () => {
	const html = renderFeedContent(
		"[招待リンク](https://app.usespeak.com/jp-ja/i/LGZDMD)",
		{ promotion: true },
	);
	assert.match(html, /<a[^>]*rel="sponsored nofollow noopener"[^>]*>/);
	assert.match(html, /<a[^>]*target="_blank"[^>]*>/);
});

test("leaves other external links without rel", () => {
	const html = renderFeedContent("[example](https://example.com/)", {});
	assert.match(html, /<a[^>]*href="https:\/\/example\.com\/"[^>]*>/);
	assert.doesNotMatch(html, /rel=/);
});

test("renders admonition directives as blockquotes without raw markers", () => {
	const html = renderFeedContent(":::note\n中身のテキスト\n:::\n", {});
	assert.match(html, /<blockquote>/);
	assert.match(html, /<strong>NOTE<\/strong>/);
	assert.match(html, /中身のテキスト/);
	assert.doesNotMatch(html, /:::/);
});

test("prepends promotion notice only when promotion is true", () => {
	const notice = "本記事はプロモーション (紹介リンク) を含みます";
	const promoted = renderFeedContent("本文", { promotion: true });
	const plain = renderFeedContent("本文", {});
	assert.ok(promoted.startsWith(`<p>${notice}</p>`));
	assert.ok(!plain.includes(notice));
});
