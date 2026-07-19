#!/usr/bin/env node
/**
 * Fixed policy evaluator for the Dependabot auto-merge workflow.
 *
 * Usage: UPDATED_DEPS_JSON='<json>' node scripts/ci/evaluate-automerge-policy.mjs
 *
 * Reads the `updated-dependencies-json` output of dependabot/fetch-metadata
 * from the UPDATED_DEPS_JSON environment variable and prints "true" when
 * every updated dependency satisfies the auto-merge policy, otherwise
 * "false". Deny reasons go to stderr so the workflow log records which rule
 * sent the PR to manual review.
 *
 * The input is derived from Dependabot branch metadata and is treated as
 * untrusted. This script fails closed: any parse failure, unexpected shape,
 * or missing field prints "false" with exit code 0. A non-zero exit only
 * signals an internal error, which the calling workflow step surfaces as a
 * job failure.
 *
 * Policy matrix (all dependencies in the PR must pass individually):
 *   patch  -> auto-merge for every dependency type
 *   minor  -> auto-merge only for direct:development
 *   major  -> never
 * Additionally: stable releases only (no 0.x, no pre-release), no maintainer
 * changes, npm ecosystem at the repository root targeting main, and no
 * denylisted package.
 */

const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_DEPENDENCIES = 100;

// Updating @playwright/test requires bumping the pinned CI container image
// digest and regenerating VRT baselines in the same manually reviewed PR.
const DENYLIST = new Set(["@playwright/test"]);

// Stable releases only. SemVer allows breaking changes in any 0.x release,
// and the pattern also rejects pre-release and build-metadata suffixes.
const STABLE_VERSION_RE = /^v?[1-9][0-9]*\.[0-9]+\.[0-9]+$/;

const PATCH = "version-update:semver-patch";
const MINOR = "version-update:semver-minor";
const DEVELOPMENT = "direct:development";

const KNOWN_DEPENDENCY_TYPES = new Set([
	"direct:production",
	DEVELOPMENT,
	"indirect",
]);

/**
 * fetch-metadata serializes maintainerChanges as a boolean inside
 * updated-dependencies-json, but its scalar outputs are strings; accept both
 * spellings of "no maintainer changes".
 * @param {unknown} value
 * @returns {boolean}
 */
function isFalse(value) {
	return value === false || value === "false";
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isStableVersion(value) {
	return typeof value === "string" && STABLE_VERSION_RE.test(value);
}

/**
 * @param {unknown} entry
 * @param {number} index
 * @returns {string[]} deny reasons for this dependency (empty when allowed)
 */
function checkDependency(entry, index) {
	const label = `dependency[${index}]`;
	if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
		return [`${label}: entry is not an object`];
	}
	const dep = /** @type {Record<string, unknown>} */ (entry);
	const name =
		typeof dep.dependencyName === "string" && dep.dependencyName !== ""
			? dep.dependencyName
			: "";
	const reasons = [];
	if (name === "") {
		reasons.push(`${label}: dependencyName is missing`);
	}
	if (dep.packageEcosystem !== "npm_and_yarn") {
		reasons.push(
			`${label} (${name}): packageEcosystem ${String(dep.packageEcosystem)} is not npm_and_yarn`,
		);
	}
	if (dep.directory !== "/") {
		reasons.push(
			`${label} (${name}): directory ${String(dep.directory)} is not the repository root`,
		);
	}
	if (dep.targetBranch !== "main") {
		reasons.push(
			`${label} (${name}): targetBranch ${String(dep.targetBranch)} is not main`,
		);
	}
	if (!isFalse(dep.maintainerChanges)) {
		reasons.push(
			`${label} (${name}): maintainer changes require manual review`,
		);
	}
	if (DENYLIST.has(name)) {
		reasons.push(
			`${label} (${name}): denylisted; update it in a manual PR together with the CI container image and VRT baselines`,
		);
	}
	if (!isStableVersion(dep.prevVersion)) {
		reasons.push(
			`${label} (${name}): prevVersion ${String(dep.prevVersion)} is not a stable release`,
		);
	}
	if (!isStableVersion(dep.newVersion)) {
		reasons.push(
			`${label} (${name}): newVersion ${String(dep.newVersion)} is not a stable release`,
		);
	}
	if (
		typeof dep.dependencyType !== "string" ||
		!KNOWN_DEPENDENCY_TYPES.has(dep.dependencyType)
	) {
		reasons.push(
			`${label} (${name}): dependencyType ${String(dep.dependencyType)} is not a known value`,
		);
	}
	const updateAllowed =
		dep.updateType === PATCH ||
		(dep.updateType === MINOR && dep.dependencyType === DEVELOPMENT);
	if (!updateAllowed) {
		reasons.push(
			`${label} (${name}): updateType ${String(dep.updateType)} with dependencyType ${String(dep.dependencyType)} requires manual review`,
		);
	}
	return reasons;
}

/**
 * @param {unknown} updatedDependencies
 * @returns {{ eligible: boolean, reasons: string[] }}
 */
function evaluatePolicy(updatedDependencies) {
	if (!Array.isArray(updatedDependencies)) {
		return { eligible: false, reasons: ["input is not a JSON array"] };
	}
	if (updatedDependencies.length === 0) {
		return { eligible: false, reasons: ["no updated dependencies"] };
	}
	if (updatedDependencies.length > MAX_DEPENDENCIES) {
		return {
			eligible: false,
			reasons: [`more than ${MAX_DEPENDENCIES} updated dependencies`],
		};
	}
	const reasons = updatedDependencies.flatMap((entry, index) =>
		checkDependency(entry, index),
	);
	return { eligible: reasons.length === 0, reasons };
}

function main() {
	const raw = process.env.UPDATED_DEPS_JSON ?? "";
	if (Buffer.byteLength(raw, "utf8") > MAX_INPUT_BYTES) {
		console.error("evaluate-automerge-policy: input exceeds the size limit");
		console.log("false");
		return;
	}
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		console.error("evaluate-automerge-policy: input is not valid JSON");
		console.log("false");
		return;
	}
	const { eligible, reasons } = evaluatePolicy(parsed);
	for (const reason of reasons) {
		console.error(`evaluate-automerge-policy: ${reason}`);
	}
	console.log(eligible ? "true" : "false");
}

main();
