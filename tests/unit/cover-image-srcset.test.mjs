import assert from "node:assert/strict";
import { test } from "node:test";
import { coverImageSrcset } from "../../src/utils/cover-image-srcset.mjs";

test("a 16:9 image in a 65vh banner switches to height-bound below 52/45", () => {
	assert.equal(
		coverImageSrcset(3840, 2160, 65).sizes,
		"(min-aspect-ratio: 52/45) 100vw, 115.56vh",
	);
});

test("a 3:2 image reduces the ratio regardless of its pixel size", () => {
	const expected = "(min-aspect-ratio: 39/40) 100vw, 97.5vh";
	assert.equal(coverImageSrcset(3840, 2560, 65).sizes, expected);
	assert.equal(coverImageSrcset(1344, 896, 65).sizes, expected);
});

test("the rendered height-bound width is rounded up, never down", () => {
	// 65 * 1000 / 999 = 65.065..., and 65000/99900 reduces to 650/999
	assert.equal(
		coverImageSrcset(1000, 999, 65).sizes,
		"(min-aspect-ratio: 650/999) 100vw, 65.07vh",
	);
});

test("exact rendered widths are not bumped by floating-point error", () => {
	// Dividing before multiplying by 100 used to yield 1.11 here.
	assert.equal(
		coverImageSrcset(110, 6500, 65).sizes,
		"(min-aspect-ratio: 11/1000) 100vw, 1.1vh",
	);
	assert.equal(
		coverImageSrcset(4000, 1000, 65).sizes,
		"(min-aspect-ratio: 13/5) 100vw, 260vh",
	);
});

test("a fractional box height keeps an integer ratio", () => {
	assert.equal(
		coverImageSrcset(3840, 2160, 67.5).sizes,
		"(min-aspect-ratio: 6/5) 100vw, 120vh",
	);
});

test("widths are returned as a fresh array each call", () => {
	const first = coverImageSrcset(3840, 2160, 65).widths;
	first.reverse();
	assert.deepEqual(
		coverImageSrcset(3840, 2160, 65).widths,
		[1366, 1920, 2560, 2880, 3200, 3840],
	);
});

test("invalid dimensions or box heights are rejected", () => {
	assert.throws(() => coverImageSrcset(3840.5, 2160, 65), TypeError);
	assert.throws(() => coverImageSrcset(0, 2160, 65), TypeError);
	assert.throws(() => coverImageSrcset(3840, Number.NaN, 65), TypeError);
	assert.throws(() => coverImageSrcset(3840, 2160, 0), TypeError);
	assert.throws(
		() => coverImageSrcset(3840, 2160, Number.POSITIVE_INFINITY),
		TypeError,
	);
});
