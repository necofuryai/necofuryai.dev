import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// build.yml の UI smoke job は digest 固定した mcr.microsoft.com/playwright の container で動き、
// Playwright は package version ごとに決まる browser revision の path (/ms-playwright/chromium_headless_shell-<rev>)
// を探す。@playwright/test だけを上げると全 test が browserType.launch で落ちるため (PR #89, #278, #290)、
// package と image tag が同じ version を指していることをここで確かめる。
const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const IMAGE_PATTERN =
	/mcr\.microsoft\.com\/playwright:v(?<version>[^\s@-]+)-(?<distro>[a-z]+)@sha256:(?<digest>[0-9a-f]{64})/g;

const packageVersion = () => {
	const version = JSON.parse(read("package.json")).devDependencies[
		"@playwright/test"
	];
	assert.match(
		version,
		/^\d+\.\d+\.\d+$/,
		"@playwright/test must be pinned to an exact version so the container image tag can match it",
	);
	return version;
};

test("@playwright/test in pnpm-lock.yaml resolves to the version in package.json", () => {
	const version = packageVersion();
	const lock = read("pnpm-lock.yaml");
	assert.match(
		lock,
		new RegExp(
			`\\n {6}'@playwright/test':\\n {8}specifier: ${version.replaceAll(".", "\\.")}\\n {8}version: ${version.replaceAll(".", "\\.")}\\n`,
		),
	);
	assert.match(
		lock,
		new RegExp(`\\n  playwright-core@${version.replaceAll(".", "\\.")}:\\n`),
	);
});

test("the UI smoke container image matches @playwright/test and is pinned by digest", () => {
	const version = packageVersion();
	const images = [
		...read(".github/workflows/build.yml").matchAll(IMAGE_PATTERN),
	];
	assert.equal(
		images.length,
		1,
		"expected exactly one digest-pinned Playwright image in build.yml",
	);
	assert.equal(
		images[0].groups.version,
		version,
		`build.yml uses mcr.microsoft.com/playwright:v${images[0].groups.version}-${images[0].groups.distro} but @playwright/test is ${version}; bump the image tag and digest in the same PR`,
	);
	assert.equal(images[0].groups.distro, "noble");
	// tag を書かずに digest だけ、あるいは digest なしの tag だけの参照を取りこぼさない
	assert.doesNotMatch(
		read(".github/workflows/build.yml").replace(IMAGE_PATTERN, ""),
		/mcr\.microsoft\.com\/playwright/,
	);
});
