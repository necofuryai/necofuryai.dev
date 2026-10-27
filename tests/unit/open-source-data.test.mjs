import assert from "node:assert/strict";
import { test } from "node:test";
import {
	openSourceContributions,
	statusCheckedAt,
} from "../../src/data/open-source.ts";

// 手で書く日付と URL の取り違えを、ビルド時の不明瞭な RangeError ではなくここで止める
const isCalendarDay = (value) =>
	/^\d{4}-\d{2}-\d{2}$/.test(value) &&
	new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

const datesOf = (item) =>
	"date" in item.status ? [item.opened, item.status.date] : [item.opened];

test("every date is a real YYYY-MM-DD calendar day", () => {
	assert.ok(isCalendarDay(statusCheckedAt), statusCheckedAt);
	for (const item of openSourceContributions) {
		for (const date of datesOf(item)) {
			assert.ok(isCalendarDay(date), `${item.url}: ${date}`);
		}
	}
});

test("each entry links to its own number in its own repository", () => {
	for (const item of openSourceContributions) {
		assert.ok(
			item.url.startsWith(`https://github.com/${item.repo}/`),
			item.url,
		);
		assert.ok(item.url.endsWith(`/${item.number}`), item.url);
		for (const link of item.related ?? []) {
			assert.ok(link.url.startsWith("https://github.com/"), link.url);
		}
	}
});

test("a release links to its tag in the same repository", () => {
	for (const item of openSourceContributions) {
		if (item.status.state !== "released") continue;
		assert.equal(
			item.status.url,
			`https://github.com/${item.repo}/releases/tag/${item.status.version}`,
		);
	}
});

test("merge and release dates fall between opening and the last status check", () => {
	for (const item of openSourceContributions) {
		for (const date of datesOf(item)) {
			assert.ok(date >= item.opened, `${item.url}: ${date}`);
			assert.ok(date <= statusCheckedAt, `${item.url}: ${date}`);
		}
	}
});
