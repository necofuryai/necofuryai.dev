import assert from "node:assert/strict";

// YAML パーサは依存にないため、行単位で指定したステップの run: | のブロックを取り出し、
// GitHub Actions のブロックスカラーと同じく共通の字下げを外して返す。
// ワークフローの形が変わって取り出せなくなったら、空振りせずに失敗させる。
export function extractRunScript(yaml, stepName) {
	const lines = yaml.split(/\r?\n/);
	const nameIndex = lines.findIndex(
		(line) => line.trim() === `- name: ${stepName}`,
	);
	assert.notEqual(nameIndex, -1, `${stepName} ステップが見つからない`);
	const runIndex = lines.findIndex(
		(line, index) => index > nameIndex && /^\s*run: \|\s*$/.test(line),
	);
	assert.notEqual(runIndex, -1, "run: | が見つからない");
	assert.ok(
		!lines.slice(nameIndex + 1, runIndex).some((line) => /^\s*- /.test(line)),
		`run: | が ${stepName} ステップの外にある`,
	);

	const runIndent = lines[runIndex].search(/\S/);
	const body = [];
	for (const line of lines.slice(runIndex + 1)) {
		if (line.trim() !== "" && line.search(/\S/) <= runIndent) break;
		body.push(line);
	}
	const indent = Math.min(
		...body
			.filter((line) => line.trim() !== "")
			.map((line) => line.search(/\S/)),
	);
	return body.map((line) => line.slice(indent)).join("\n");
}
