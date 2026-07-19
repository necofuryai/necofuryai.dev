import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(
	new URL("./evaluate-automerge-policy.mjs", import.meta.url),
);

function dep(overrides = {}) {
	return {
		dependencyName: "@fontsource/roboto",
		dependencyType: "direct:production",
		updateType: "version-update:semver-patch",
		directory: "/",
		packageEcosystem: "npm_and_yarn",
		targetBranch: "main",
		prevVersion: "5.2.9",
		newVersion: "5.2.10",
		compatScore: 0,
		maintainerChanges: false,
		dependencyGroup: "",
		...overrides,
	};
}

function run(input, options = {}) {
	const env = { ...process.env };
	delete env.UPDATED_DEPS_JSON;
	if (!options.unsetEnv) {
		env.UPDATED_DEPS_JSON =
			typeof input === "string" ? input : JSON.stringify(input);
	}
	const result = spawnSync(process.execPath, [SCRIPT], {
		encoding: "utf8",
		env,
	});
	assert.equal(result.status, 0, result.stderr);
	return { verdict: result.stdout.trim(), stderr: result.stderr };
}

test("production patch update is eligible", () => {
	assert.equal(run([dep()]).verdict, "true");
});

test("development minor update is eligible", () => {
	const input = [
		dep({
			dependencyName: "@types/hast",
			dependencyType: "direct:development",
			updateType: "version-update:semver-minor",
			prevVersion: "3.0.4",
			newVersion: "3.1.0",
		}),
	];
	assert.equal(run(input).verdict, "true");
});

test("indirect patch update is eligible", () => {
	const input = [
		dep({
			dependencyName: "follow-redirects",
			dependencyType: "indirect",
			prevVersion: "1.16.0",
			newVersion: "1.16.1",
		}),
	];
	assert.equal(run(input).verdict, "true");
});

test("production minor update requires manual review", () => {
	const input = [
		dep({
			dependencyName: "unist-util-visit",
			updateType: "version-update:semver-minor",
			prevVersion: "5.0.0",
			newVersion: "5.1.0",
		}),
	];
	const { verdict, stderr } = run(input);
	assert.equal(verdict, "false");
	assert.match(stderr, /requires manual review/);
});

test("major update requires manual review even for development", () => {
	const input = [
		dep({
			dependencyName: "@types/mdast",
			dependencyType: "direct:development",
			updateType: "version-update:semver-major",
			prevVersion: "4.0.4",
			newVersion: "5.0.0",
		}),
	];
	assert.equal(run(input).verdict, "false");
});

test("denylisted @playwright/test never auto-merges", () => {
	const input = [
		dep({
			dependencyName: "@playwright/test",
			dependencyType: "direct:development",
			prevVersion: "1.61.1",
			newVersion: "1.61.2",
		}),
	];
	const { verdict, stderr } = run(input);
	assert.equal(verdict, "false");
	assert.match(stderr, /denylisted/);
});

test("grouped PR with all patch updates is eligible", () => {
	const input = [
		dep({
			dependencyName: "sanitize-html",
			prevVersion: "2.17.0",
			newVersion: "2.17.6",
			dependencyGroup: "sanitize-html",
		}),
		dep({
			dependencyName: "@types/sanitize-html",
			dependencyType: "direct:development",
			prevVersion: "2.16.0",
			newVersion: "2.16.1",
			dependencyGroup: "sanitize-html",
		}),
	];
	assert.equal(run(input).verdict, "true");
});

test("grouped PR containing one production minor is denied entirely", () => {
	const input = [
		dep({
			dependencyName: "astro",
			prevVersion: "7.1.1",
			newVersion: "7.1.2",
			dependencyGroup: "astro-svelte",
		}),
		dep({
			dependencyName: "svelte",
			updateType: "version-update:semver-minor",
			prevVersion: "5.46.4",
			newVersion: "5.47.0",
			dependencyGroup: "astro-svelte",
		}),
	];
	assert.equal(run(input).verdict, "false");
});

test("0.x package is denied", () => {
	const input = [
		dep({
			dependencyName: "@expressive-code/core",
			prevVersion: "0.44.0",
			newVersion: "0.44.1",
		}),
	];
	assert.equal(run(input).verdict, "false");
});

test("pre-release version is denied", () => {
	assert.equal(run([dep({ newVersion: "5.2.10-rc.1" })]).verdict, "false");
});

test("maintainer changes are denied", () => {
	assert.equal(run([dep({ maintainerChanges: true })]).verdict, "false");
});

test("string 'false' maintainerChanges is accepted", () => {
	assert.equal(run([dep({ maintainerChanges: "false" })]).verdict, "true");
});

test("non npm_and_yarn ecosystem is denied", () => {
	assert.equal(run([dep({ packageEcosystem: "npm" })]).verdict, "false");
});

test("non-root directory is denied", () => {
	assert.equal(run([dep({ directory: "/packages/site" })]).verdict, "false");
});

test("non-main target branch is denied", () => {
	assert.equal(run([dep({ targetBranch: "develop" })]).verdict, "false");
});

test("unknown dependencyType is denied even for patch", () => {
	assert.equal(run([dep({ dependencyType: "unknown" })]).verdict, "false");
});

test("missing dependencyType is denied", () => {
	assert.equal(run([dep({ dependencyType: undefined })]).verdict, "false");
});

test("missing version fields are denied", () => {
	assert.equal(run([dep({ prevVersion: undefined })]).verdict, "false");
});

test("empty array is denied", () => {
	assert.equal(run([]).verdict, "false");
});

test("non-array JSON is denied", () => {
	assert.equal(run({ dependencyName: "x" }).verdict, "false");
});

test("invalid JSON is denied", () => {
	assert.equal(run("not json").verdict, "false");
});

test("missing environment variable is denied", () => {
	assert.equal(run(undefined, { unsetEnv: true }).verdict, "false");
});

test("oversized dependency list is denied", () => {
	const input = Array.from({ length: 101 }, () => dep());
	assert.equal(run(input).verdict, "false");
});
