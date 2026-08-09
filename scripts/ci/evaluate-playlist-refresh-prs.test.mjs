import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluatePlaylistRefreshPullRequests } from "./evaluate-playlist-refresh-prs.mjs";

const NOW = new Date("2026-08-09T12:00:00Z");
const REQUIRED_CHECKS = [
	"CI OK",
	"quality",
	"Dependency Review",
	"Dependabot Auto-merge Policy",
];

function pullRequest(overrides = {}) {
	return {
		number: 94,
		url: "https://github.com/necofuryai/necofuryai.dev/pull/94",
		createdAt: "2026-08-08T11:00:00Z",
		author: { is_bot: true, login: "app/github-actions" },
		headRefName: "data/refresh-playlists-30830065070",
		isCrossRepository: false,
		statusCheckRollup: [],
		...overrides,
	};
}

function completedCheck(name, conclusion = "SUCCESS") {
	return { __typename: "CheckRun", name, status: "COMPLETED", conclusion };
}

test("ignores refresh pull requests younger than 24 hours", () => {
	const result = evaluatePlaylistRefreshPullRequests(
		[pullRequest({ createdAt: "2026-08-08T12:00:01Z" })],
		{ now: NOW },
	);
	assert.deepEqual(result, { stale: false, count: 0, report: "" });
});

test("reports a 24-hour-old pull request with no generated checks", () => {
	const result = evaluatePlaylistRefreshPullRequests(
		[pullRequest({ createdAt: "2026-08-08T12:00:00Z" })],
		{ now: NOW },
	);
	assert.equal(result.stale, true);
	assert.equal(result.count, 1);
	assert.match(result.report, /PR #94/);
	assert.match(result.report, /作成: 2026-08-08T12:00:00.000Z/);
	assert.match(result.report, /Approve workflows to run/);
});

test("reports a pull request whose required checks all succeeded", () => {
	const result = evaluatePlaylistRefreshPullRequests(
		[
			pullRequest({
				statusCheckRollup: REQUIRED_CHECKS.map((name) => completedCheck(name)),
			}),
		],
		{ now: NOW },
	);
	assert.equal(result.stale, true);
	assert.match(result.report, /required checks はすべて成功済み/);
});

test("distinguishes missing, pending, and failed required checks", () => {
	const result = evaluatePlaylistRefreshPullRequests(
		[
			pullRequest({
				statusCheckRollup: [
					completedCheck("CI OK"),
					{
						__typename: "CheckRun",
						name: "quality",
						status: "IN_PROGRESS",
						conclusion: null,
					},
					completedCheck("Dependency Review", "FAILURE"),
				],
			}),
		],
		{ now: NOW },
	);
	assert.match(result.report, /未生成: `Dependabot Auto-merge Policy`/);
	assert.match(result.report, /実行中: `quality`/);
	assert.match(result.report, /失敗: `Dependency Review`/);
});

test("ignores commit statuses because branch protection requires CheckRuns", () => {
	const result = evaluatePlaylistRefreshPullRequests(
		[
			pullRequest({
				statusCheckRollup: [
					{ __typename: "StatusContext", context: "CI OK", state: "SUCCESS" },
					...REQUIRED_CHECKS.slice(1).map((name) => completedCheck(name)),
				],
			}),
		],
		{ now: NOW },
	);
	assert.match(result.report, /未生成: `CI OK`/);
});

test("requires every duplicate required check to succeed", () => {
	const result = evaluatePlaylistRefreshPullRequests(
		[
			pullRequest({
				statusCheckRollup: [
					...REQUIRED_CHECKS.map((name) => completedCheck(name)),
					completedCheck("CI OK", "FAILURE"),
				],
			}),
		],
		{ now: NOW },
	);
	assert.match(result.report, /失敗: `CI OK`/);
});

test("treats neutral and skipped check conclusions as successful", () => {
	const result = evaluatePlaylistRefreshPullRequests(
		[
			pullRequest({
				statusCheckRollup: [
					completedCheck("CI OK", "NEUTRAL"),
					completedCheck("quality", "SKIPPED"),
					...REQUIRED_CHECKS.slice(2).map((name) => completedCheck(name)),
				],
			}),
		],
		{ now: NOW },
	);
	assert.match(result.report, /required checks はすべて成功済み/);
});

test("ignores non-bot and cross-repository pull requests", () => {
	const result = evaluatePlaylistRefreshPullRequests(
		[
			pullRequest({ author: { is_bot: false, login: "necofuryai" } }),
			pullRequest({
				author: { is_bot: true, login: "app/another-automation" },
			}),
			pullRequest({ headRefName: "feature/not-a-refresh" }),
			pullRequest({ isCrossRepository: true }),
		],
		{ now: NOW },
	);
	assert.deepEqual(result, { stale: false, count: 0, report: "" });
});

test("sorts multiple stale pull requests by creation time", () => {
	const result = evaluatePlaylistRefreshPullRequests(
		[
			pullRequest({
				number: 95,
				url: "https://github.com/necofuryai/necofuryai.dev/pull/95",
				createdAt: "2026-08-07T12:00:00Z",
			}),
			pullRequest({ createdAt: "2026-08-06T12:00:00Z" }),
		],
		{ now: NOW },
	);
	assert.ok(result.report.indexOf("PR #94") < result.report.indexOf("PR #95"));
});

test("fails closed for malformed matching pull request data", () => {
	assert.throws(
		() =>
			evaluatePlaylistRefreshPullRequests(
				[pullRequest({ statusCheckRollup: null })],
				{ now: NOW },
			),
		/statusCheckRollup must be an array/,
	);
	assert.throws(
		() => evaluatePlaylistRefreshPullRequests({}, { now: NOW }),
		/top-level value must be an array/,
	);
});
