// diff-cloudflare-skills.mjs の回帰テスト用に globalThis.fetch を差し替える。
// `node --import <このファイル> <スクリプト>` で読み込ませ、実際の通信は一切行わない。
// 想定外の URL は例外にするので、スクリプトが上流以外へ通信しようとすればテストが落ちる。
//
// STUB_FETCH_MODE で上流の状態を、STUB_FETCH_TARGET (.claude/skills/ からの相対パス) で
// その状態にするファイルを指定する。
// - match: 各ファイルに手元と同じ内容を返す。LOCALLY_MODIFIED だけは手元と異なる内容を返し「改変」にする
// - diff: match に加え、TARGET の内容だけを変える
// - gone: match に加え、TARGET だけ 404 を返す
// - http-error: match に加え、TARGET だけ 500 を返す
// - network-error: match に加え、TARGET だけ fetch 自体を失敗させる
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
	FILES,
	LOCALLY_MODIFIED,
	UPSTREAM,
} from "../../../scripts/cloudflare-skills-manifest.mjs";

const mode = process.env.STUB_FETCH_MODE ?? "match";
const TARGET = process.env.STUB_FETCH_TARGET;
if (mode !== "match" && !FILES.some(([local]) => local === TARGET)) {
	throw new Error(`stub-fetch: STUB_FETCH_TARGET が FILES にない: ${TARGET}`);
}
// 実行中のスクリプトの位置から同梱ディレクトリを求める (一時ディレクトリへ複製した木でも動くように)
const skillsDir = new URL("../.claude/skills/", pathToFileURL(process.argv[1]));
const localByUrl = new Map(
	FILES.map(([local, upstream]) => [`${UPSTREAM}/${upstream}`, local]),
);

function readLocal(name) {
	try {
		return readFileSync(new URL(name, skillsDir), "utf8");
	} catch (error) {
		// 手元のファイルが欠落しているケースでも、上流には存在する体で内容を返す
		if (error.code === "ENOENT") return "stub upstream content\n";
		throw error;
	}
}

globalThis.fetch = async (input) => {
	const url = String(input);
	const name = localByUrl.get(url);
	if (name === undefined) throw new Error(`stub-fetch: 想定外の URL ${url}`);

	if (name === TARGET) {
		if (mode === "gone") return new Response("404: Not Found", { status: 404 });
		if (mode === "http-error") {
			return new Response("", {
				status: 500,
				statusText: "Internal Server Error",
			});
		}
		if (mode === "network-error") {
			throw new TypeError("fetch failed", {
				cause: new Error("stub: connection refused"),
			});
		}
	}

	let body = readLocal(name);
	if (LOCALLY_MODIFIED.has(name)) body += "\nupstream-only line\n";
	if (name === TARGET && mode === "diff") body += "\nchanged upstream\n";
	return new Response(body, { status: 200 });
};
