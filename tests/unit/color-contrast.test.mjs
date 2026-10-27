import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// 訪問者がテーマの色相 (0〜360) を選べるので、文字やアイコンに使うトークンが
// どの色相でも WCAG の基準 (文字 4.5:1、大きな文字とアイコン 3:1) を満たすことを
// variables.css の値から確かめる
const css = readFileSync(
	new URL("../../src/styles/variables.css", import.meta.url),
	"utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

// カスケードと同じく後の宣言が勝つよう、各スコープの宣言を出てきた順に並べる。
// :root.dark は :root より詳細度が高いので、ダークではライトの宣言の後ろに置く
const bodies = (selector) =>
	[...css.matchAll(/(:root(?:\.dark)?)\s*\{([^}]*)\}/g)]
		.filter(([, name]) => name === selector)
		.map(([, , body]) => body);
const SCOPES = {
	light: bodies(":root").join("\n"),
	dark: [...bodies(":root"), ...bodies(":root.dark")].join("\n"),
};

const declared = (scope, name) => {
	const values = [
		...SCOPES[scope].matchAll(new RegExp(`${name}:\\s*([^;]+);`, "g")),
	];
	assert.ok(values.length > 0, `${name} is not declared for ${scope}`);
	return values.at(-1)[1].trim();
};

// "oklch(L C var(--hue))"・"oklch(L C H)"・"white"・"var(--x)" を { l, c, h } か "white" に読む。
// h はアドモニションのように色相を固定した色だけが持ち、無ければテーマの色相に従う
const token = (scope, name) => {
	const value = declared(scope, name);
	const reference = value.match(/^var\((--[\w-]+)\)$/);
	if (reference) return token(scope, reference[1]);
	if (value === "white") return "white";
	const oklch = value.match(
		/^oklch\(([\d.]+) ([\d.]+) (?:var\(--hue\)|([\d.]+))\)$/,
	);
	assert.ok(oklch, `${name} for ${scope} is not a supported value: ${value}`);
	return {
		l: Number(oklch[1]),
		c: Number(oklch[2]),
		h: oklch[3] === undefined ? undefined : Number(oklch[3]),
	};
};

// OKLCH → 線形 sRGB (Björn Ottosson の行列)
const toLinearSrgb = ({ l, c, h: fixedHue }, hue) => {
	const h = ((fixedHue ?? hue) * Math.PI) / 180;
	const a = c * Math.cos(h);
	const b = c * Math.sin(h);
	const lms = [
		l + 0.3963377774 * a + 0.2158037573 * b,
		l - 0.1055613458 * a - 0.0638541728 * b,
		l - 0.0894841775 * a - 1.291485548 * b,
	].map((v) => v ** 3);
	return [
		4.0767416621 * lms[0] - 3.3077115913 * lms[1] + 0.2309699292 * lms[2],
		-1.2684380046 * lms[0] + 2.6097574011 * lms[1] - 0.3413193965 * lms[2],
		-0.0041960863 * lms[0] - 0.7034186147 * lms[1] + 1.707614701 * lms[2],
	];
};
const inGamut = (rgb) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
const clip = (rgb) => rgb.map((v) => Math.min(1, Math.max(0, v)));
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// 範囲外の色は、各チャンネルの切り捨てと彩度の縮小 (CSS Color 4 の方式) の
// 両方で求める。ブラウザごとの扱いの違いに左右されないよう、組み合わせの最悪値を採る
const luminances = (color, hue) => {
	if (color === "white") return [1];
	const rgb = toLinearSrgb(color, hue);
	if (inGamut(rgb)) return [luminance(clip(rgb))];
	let low = 0;
	let high = color.c;
	for (let i = 0; i < 30; i++) {
		const mid = (low + high) / 2;
		if (inGamut(toLinearSrgb({ ...color, c: mid }, hue))) low = mid;
		else high = mid;
	}
	return [
		luminance(clip(rgb)),
		luminance(clip(toLinearSrgb({ ...color, c: low }, hue))),
	];
};
const worstContrast = (fg, bg) => {
	let worst = Number.POSITIVE_INFINITY;
	for (let hue = 0; hue <= 360; hue++) {
		for (const bgY of luminances(bg, hue)) {
			for (const fgY of luminances(fg, hue)) {
				const ratio = (Math.max(fgY, bgY) + 0.05) / (Math.min(fgY, bgY) + 0.05);
				worst = Math.min(worst, ratio);
			}
		}
	}
	return worst;
};

const TEXT = 4.5;
const LARGE_TEXT_OR_ICON = 3;
const assertContrast = (scope, fgName, bgNames, minimum) => {
	for (const bgName of bgNames) {
		const ratio = worstContrast(token(scope, fgName), token(scope, bgName));
		assert.ok(
			ratio >= minimum,
			`${scope} ${fgName} on ${bgName}: worst ${ratio.toFixed(2)}:1 across hues 0-360, needs ${minimum}:1`,
		);
	}
};

test("light --primary-text reads as text on the backgrounds links and marks sit on", () => {
	assertContrast(
		"light",
		"--primary-text",
		[
			"--card-bg",
			"--page-bg",
			"--float-panel-bg",
			"--btn-plain-bg-hover",
			"--btn-plain-bg-active",
			"--btn-card-bg-hover",
		],
		TEXT,
	);
});

test("light --primary-text icons stay visible on button backgrounds in every state", () => {
	// Pagination and post navigation arrows, BackToTop, and the PostCard enter chevron
	assertContrast(
		"light",
		"--primary-text",
		[
			"--btn-card-bg-active",
			"--btn-regular-bg",
			"--btn-regular-bg-hover",
			"--btn-regular-bg-active",
		],
		LARGE_TEXT_OR_ICON,
	);
});

test("white page numbers read on a light --primary-text background", () => {
	const ratio = worstContrast("white", token("light", "--primary-text"));
	assert.ok(ratio >= TEXT, `worst ${ratio.toFixed(2)}:1`);
});

test("light --btn-content reads on buttons in every state", () => {
	assertContrast(
		"light",
		"--btn-content",
		[
			"--btn-regular-bg",
			"--btn-regular-bg-hover",
			"--btn-regular-bg-active",
			"--toc-badge-bg",
		],
		TEXT,
	);
});

test("light --title-active reads on cards", () => {
	assertContrast("light", "--title-active", ["--card-bg"], TEXT);
});

test("link underlines are visible as a cue besides color in both themes", () => {
	// Link text is close in lightness to body text, so the underline must show.
	// Footer links sit on the page background rather than on a card
	for (const scope of ["light", "dark"]) {
		assertContrast(
			scope,
			"--link-underline",
			["--card-bg", "--page-bg"],
			LARGE_TEXT_OR_ICON,
		);
	}
});

test("admonition titles and icons read on cards in both themes", () => {
	for (const type of ["tip", "note", "important", "warning", "caution"]) {
		for (const scope of ["light", "dark"]) {
			assertContrast(scope, `--admonitions-text-${type}`, ["--card-bg"], TEXT);
		}
	}
});

test("dark --primary-text stays --primary and reads on dark backgrounds", () => {
	assert.equal(declared("dark", "--primary-text"), "var(--primary)");
	assertContrast(
		"dark",
		"--primary-text",
		[
			"--card-bg",
			"--page-bg",
			"--float-panel-bg",
			"--btn-plain-bg-hover",
			"--btn-plain-bg-active",
			"--btn-card-bg-hover",
			"--btn-card-bg-active",
		],
		TEXT,
	);
});

test("dark --title-active does not inherit the darker light value", () => {
	// The post title is text-3xl bold, so the large-text minimum applies
	assertContrast("dark", "--title-active", ["--card-bg"], LARGE_TEXT_OR_ICON);
});
