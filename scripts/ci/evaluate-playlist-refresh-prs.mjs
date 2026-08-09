#!/usr/bin/env node
/**
 * Classify open Apple Music playlist refresh pull requests for the scheduled
 * monitor. Input is the JSON array emitted by `gh pr list` and output is a
 * compact JSON object suitable for passing between GitHub Actions jobs.
 */

const REFRESH_BRANCH = /^data\/refresh-playlists-\d+$/u;
const GITHUB_ACTIONS_AUTHORS = new Set([
	"app/github-actions",
	"github-actions[bot]",
]);
const EXPECTED_REPOSITORY = "necofuryai/necofuryai.dev";
const REQUIRED_CHECKS = [
	"CI OK",
	"quality",
	"Dependency Review",
	"Dependabot Auto-merge Policy",
];
const DEFAULT_STALE_AFTER_HOURS = 24;
const MAX_INPUT_BYTES = 1024 * 1024;

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function requireString(value, field) {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${field} must be a non-empty string`);
	}
	return value;
}

/**
 * @param {unknown} pullRequest
 * @returns {pullRequest is Record<string, unknown>}
 */
function isRefreshPullRequest(pullRequest) {
	const author = isRecord(pullRequest) ? pullRequest.author : null;
	return (
		isRecord(pullRequest) &&
		isRecord(author) &&
		author.is_bot === true &&
		typeof author.login === "string" &&
		GITHUB_ACTIONS_AUTHORS.has(author.login) &&
		typeof pullRequest.headRefName === "string" &&
		REFRESH_BRANCH.test(pullRequest.headRefName) &&
		pullRequest.isCrossRepository === false
	);
}

/**
 * @param {string} urlString
 * @param {number} number
 * @returns {string}
 */
function validatePullRequestUrl(urlString, number) {
	let url;
	try {
		url = new URL(urlString);
	} catch {
		throw new Error(`pull request #${number} has an invalid URL`);
	}
	if (
		url.protocol !== "https:" ||
		url.hostname !== "github.com" ||
		url.pathname !== `/${EXPECTED_REPOSITORY}/pull/${number}`
	) {
		throw new Error(`pull request #${number} has an unexpected URL`);
	}
	return url.href;
}

/**
 * @param {unknown} check
 * @returns {string | null}
 */
function checkName(check) {
	if (!isRecord(check) || check.__typename !== "CheckRun") {
		return null;
	}
	return typeof check.name === "string" ? check.name : null;
}

/**
 * @param {Record<string, unknown>} check
 * @returns {"success" | "pending" | "failed"}
 */
function checkState(check) {
	if (
		check.conclusion === "SUCCESS" ||
		check.conclusion === "NEUTRAL" ||
		check.conclusion === "SKIPPED"
	) {
		return "success";
	}
	if (check.status !== "COMPLETED" || check.conclusion === null) {
		return "pending";
	}
	return "failed";
}

/**
 * @param {unknown[]} checks
 * @returns {string}
 */
function summarizeChecks(checks) {
	const missing = [];
	const pending = [];
	const failed = [];

	for (const required of REQUIRED_CHECKS) {
		const matches = checks.filter((check) => checkName(check) === required);
		if (matches.length === 0) {
			missing.push(required);
			continue;
		}

		const states = matches.filter(isRecord).map((check) => checkState(check));
		if (states.includes("failed")) {
			failed.push(required);
		} else if (states.includes("pending")) {
			pending.push(required);
		}
	}

	if (missing.length === REQUIRED_CHECKS.length) {
		return "required checks が未生成です。通常は PR の Awaiting approval から Approve workflows to run を選択します。承認表示がなければ workflow の起動失敗を確認してください。";
	}

	const parts = [];
	if (missing.length > 0) {
		parts.push(`未生成: ${missing.map((name) => `\`${name}\``).join(", ")}`);
	}
	if (pending.length > 0) {
		parts.push(`実行中: ${pending.map((name) => `\`${name}\``).join(", ")}`);
	}
	if (failed.length > 0) {
		parts.push(`失敗: ${failed.map((name) => `\`${name}\``).join(", ")}`);
	}
	if (parts.length === 0) {
		return "required checks はすべて成功済みです。差分を確認してマージ判断を行ってください。";
	}
	return parts.join(" / ");
}

/**
 * @param {unknown} pullRequests
 * @param {{ now?: Date, staleAfterHours?: number }} [options]
 * @returns {{ stale: boolean, count: number, report: string }}
 */
export function evaluatePlaylistRefreshPullRequests(
	pullRequests,
	options = {},
) {
	if (!Array.isArray(pullRequests)) {
		throw new Error("top-level value must be an array");
	}
	const now = options.now ?? new Date();
	const staleAfterHours = options.staleAfterHours ?? DEFAULT_STALE_AFTER_HOURS;
	if (!Number.isFinite(now.getTime())) {
		throw new Error("now must be a valid Date");
	}
	if (!Number.isFinite(staleAfterHours) || staleAfterHours <= 0) {
		throw new Error("staleAfterHours must be a positive number");
	}

	const staleAfterMs = staleAfterHours * 60 * 60 * 1000;
	const stalePullRequests = [];
	for (const pullRequest of pullRequests) {
		if (!isRefreshPullRequest(pullRequest)) {
			continue;
		}
		const number = pullRequest.number;
		if (!Number.isInteger(number) || number <= 0) {
			throw new Error("refresh pull request number must be a positive integer");
		}
		const createdAtText = requireString(
			pullRequest.createdAt,
			`pull request #${number} createdAt`,
		);
		const createdAt = new Date(createdAtText);
		if (!Number.isFinite(createdAt.getTime())) {
			throw new Error(`pull request #${number} has an invalid createdAt`);
		}
		const ageMs = now.getTime() - createdAt.getTime();
		if (ageMs < staleAfterMs) {
			continue;
		}
		if (!Array.isArray(pullRequest.statusCheckRollup)) {
			throw new Error(
				`pull request #${number} statusCheckRollup must be an array`,
			);
		}
		const url = validatePullRequestUrl(
			requireString(pullRequest.url, `pull request #${number} url`),
			number,
		);
		stalePullRequests.push({
			number,
			url,
			createdAt,
			summary: summarizeChecks(pullRequest.statusCheckRollup),
		});
	}

	stalePullRequests.sort(
		(left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
	);
	if (stalePullRequests.length === 0) {
		return { stale: false, count: 0, report: "" };
	}

	const report = [
		`${staleAfterHours} 時間以上開いたままの Apple Music playlist refresh PR があります。`,
		"",
		...stalePullRequests.map(
			(pullRequest) =>
				`- [PR #${pullRequest.number}](${pullRequest.url}) — 作成: ${pullRequest.createdAt.toISOString()}。${pullRequest.summary}`,
		),
	].join("\n");
	return { stale: true, count: stalePullRequests.length, report };
}

async function main() {
	let input = "";
	process.stdin.setEncoding("utf8");
	for await (const chunk of process.stdin) {
		input += chunk;
		if (Buffer.byteLength(input, "utf8") > MAX_INPUT_BYTES) {
			throw new Error(`input exceeds ${MAX_INPUT_BYTES} bytes`);
		}
	}
	const parsed = JSON.parse(input);
	const result = evaluatePlaylistRefreshPullRequests(parsed);
	process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
	main().catch((error) => {
		console.error(
			`evaluate-playlist-refresh-prs: ${error instanceof Error ? error.message : error}`,
		);
		process.exitCode = 1;
	});
}
