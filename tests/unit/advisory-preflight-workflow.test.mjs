import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { extractRunScript } from "./fixtures/workflow-step.mjs";

// .github/workflows/dependabot-advisory-review.yml の preflight ジョブにある
// "Collect raw inputs as untrusted data" ステップを取り出し、GitHub Actions の shell: bash と同じ
// `bash --noprofile --norc -e -o pipefail` で、偽の gh を使って実行する。
// gh の出力を `| head -c` で切り詰める形では、上限を超えた出力の途中で head が先に終わると、
// gh が SIGPIPE で死に、pipefail がステップごと落としうる。その形に戻ったらここで検出する。
const WORKFLOW = new URL(
	"../../.github/workflows/dependabot-advisory-review.yml",
	import.meta.url,
);
const skip =
	process.platform === "win32" ? "bash と POSIX の PATH が前提" : false;

const STEP = extractRunScript(
	readFileSync(WORKFLOW, "utf8"),
	"Collect raw inputs as untrusted data",
);
assert.match(STEP, /pr-body-excerpt\.txt/, "本文の取得処理を取り出せていない");

const BODY_LIMIT = 65536;
const CHECKS_LIMIT = 32768;
const BUNDLE_FILES = [
	"checks-summary.txt",
	"diff.patch",
	"pr-body-excerpt.txt",
];

// 切り詰めの位置がずれたら分かるように、繰り返しの周期が上限と揃わない多バイト文字入りの内容にする
function payload(bytes, seed) {
	const unit = Buffer.from(`${seed} 本文 0123456789 🚀\n`);
	return Buffer.concat(
		Array.from({ length: Math.ceil(bytes / unit.length) }, () => unit),
	).subarray(0, bytes);
}

// 偽の gh は、本物 (Go 製) と同じく読み手が閉じたパイプへの書き込みで SIGPIPE を受けて死ぬよう、
// exec した cat に出力させる。<name>.exit があれば、何も出力せずにその終了コードで失敗する
const FAKE_GH = `#!/bin/sh
case "$*" in
*application/vnd.github.v3.diff*) name=diff ;;
*check-runs*) name=checks ;;
*.body*) name=body ;;
*) echo "unexpected gh call: $*" >&2; exit 99 ;;
esac
if [ -f "$FAKE_GH_DIR/$name.exit" ]; then exit "$(cat "$FAKE_GH_DIR/$name.exit")"; fi
exec cat "$FAKE_GH_DIR/$name"
`;

function runStep({ body, checks, bodyExit, checksExit }) {
	const dir = mkdtempSync(join(tmpdir(), "advisory-preflight-step-"));
	try {
		const bin = join(dir, "bin");
		const responses = join(dir, "responses");
		const runnerTemp = join(dir, "runner-temp");
		for (const path of [bin, responses, runnerTemp]) mkdirSync(path);
		writeFileSync(join(bin, "gh"), FAKE_GH);
		chmodSync(join(bin, "gh"), 0o755);
		writeFileSync(join(responses, "diff"), "diff --git a/x b/x\n");
		writeFileSync(join(responses, "body"), body);
		writeFileSync(join(responses, "checks"), checks);
		if (bodyExit) writeFileSync(join(responses, "body.exit"), `${bodyExit}`);
		if (checksExit)
			writeFileSync(join(responses, "checks.exit"), `${checksExit}`);
		const stepFile = join(dir, "step.sh");
		writeFileSync(stepFile, STEP);

		const result = spawnSync(
			"bash",
			["--noprofile", "--norc", "-e", "-o", "pipefail", stepFile],
			{
				encoding: "utf8",
				env: {
					...process.env,
					PATH: `${bin}${delimiter}${process.env.PATH}`,
					FAKE_GH_DIR: responses,
					RUNNER_TEMP: runnerTemp,
					GITHUB_REPOSITORY: "owner/repo",
					SOURCE_RUN_ID: "123",
					PR_NUMBER: "42",
					HEAD_SHA: "0123456789abcdef0123456789abcdef01234567",
				},
			},
		);
		const raw = join(runnerTemp, "claude-raw");
		const files = existsSync(raw)
			? Object.fromEntries(
					readdirSync(raw).map((name) => [name, readFileSync(join(raw, name))]),
				)
			: {};
		return { ...result, files };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// Buffer は assert.deepEqual に渡さない。一致しないと Node が失敗メッセージ用に差分を作ろうとして、
// 1 MiB 程度でも数十 GB のメモリと数分を使い切る。長さと最初に食い違う位置だけを数値で比べる
function assertSameBytes(actual, expected, name) {
	assert.ok(Buffer.isBuffer(actual), `${name} が作られていない`);
	assert.equal(actual.length, expected.length, `${name} のバイト数`);
	const at = actual.findIndex((byte, index) => byte !== expected[index]);
	assert.equal(at, -1, `${name} が ${at} バイト目から期待と異なる`);
}

// 一時ファイルを残さず、アーティファクトに入るのはバンドルの 3 ファイルと manifest.json だけであること。
// manifest の sha256 も、実際のファイルの内容と一致していること
function assertBundle(files) {
	assert.deepEqual(
		Object.keys(files).sort(),
		[...BUNDLE_FILES, "manifest.json"].sort(),
	);
	const manifest = JSON.parse(files["manifest.json"].toString("utf8"));
	assert.deepEqual(
		manifest.files.map((file) => file.name).sort(),
		BUNDLE_FILES,
	);
	for (const { name, sha256 } of manifest.files) {
		assert.equal(
			sha256,
			createHash("sha256").update(files[name]).digest("hex"),
			name,
		);
	}
}

for (const [label, bodyBytes, checksBytes] of [
	["under the limits", BODY_LIMIT - 1, CHECKS_LIMIT - 1],
	["exactly at the limits", BODY_LIMIT, CHECKS_LIMIT],
]) {
	test(`inputs ${label} are kept byte for byte`, { skip }, () => {
		const body = payload(bodyBytes, "body");
		const checks = payload(checksBytes, "checks");
		const result = runStep({ body, checks });
		assert.equal(result.status, 0, result.stderr);
		assertSameBytes(result.files["pr-body-excerpt.txt"], body, "本文");
		assertSameBytes(result.files["checks-summary.txt"], checks, "checks");
		assertBundle(result.files);
	});
}

// 65536 文字で頭打ちになる PR 本文に gh の末尾の改行が付いた 1 バイト超過と、
// パイプの容量を大きく超えて旧実装では必ず SIGPIPE になる 1 MiB の両方を試す
for (const [label, bodyBytes, checksBytes] of [
	["one byte over the limits", BODY_LIMIT + 1, CHECKS_LIMIT + 1],
	["far beyond the pipe capacity", 1024 * 1024, 1024 * 1024],
]) {
	test(`inputs ${label} are truncated without failing the step`, {
		skip,
	}, () => {
		const body = payload(bodyBytes, "body");
		const checks = payload(checksBytes, "checks");
		const result = runStep({ body, checks });
		assert.equal(result.status, 0, result.stderr);
		assertSameBytes(
			result.files["pr-body-excerpt.txt"],
			body.subarray(0, BODY_LIMIT),
			"本文",
		);
		assertSameBytes(
			result.files["checks-summary.txt"],
			checks.subarray(0, CHECKS_LIMIT),
			"checks",
		);
		assertBundle(result.files);
	});
}

// 取得の失敗は、空の入力として黙って先へ進めず、これまでどおりステップを失敗させる
for (const failing of ["bodyExit", "checksExit"]) {
	test(`a gh failure (${failing}) still fails the step`, { skip }, () => {
		const result = runStep({
			body: payload(100, "body"),
			checks: payload(100, "checks"),
			[failing]: 1,
		});
		assert.equal(result.status, 1);
	});
}
