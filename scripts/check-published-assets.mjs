#!/usr/bin/env node
/**
 * astro build の後に、バナーとアバターの原本が dist に残っていないかを確かめる
 * (pnpm build から呼ばれる)。原本が残っても Workers Static Assets は 25 MiB まで
 * 受け付けてそのまま配信するので、ここで止める。判定は scripts/site-assets.mjs の
 * findPublishingProblems を参照。
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	findPublishingProblems,
	SITE_ASSETS,
	sha256Hex,
} from "./site-assets.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const distDir = path.join(root, "dist/_astro");

const outputDigests = {};
for (const asset of SITE_ASSETS) {
	outputDigests[asset.output] = sha256Hex(
		await readFile(path.join(root, asset.output)),
	);
}
// 原本と同じ内容のファイルは、名前に関係なく探す (中身を読むのは画像だけ)
const names = (await readdir(distDir)).filter((name) =>
	/\.(png|jpe?g|webp|avif|gif)$/.test(name),
);
const distFiles = [];
for (const name of names) {
	distFiles.push({
		name,
		sha256: sha256Hex(await readFile(path.join(distDir, name))),
	});
}

const problems = findPublishingProblems(distFiles, outputDigests);
if (problems.length > 0) {
	for (const problem of problems) console.error(`[site-assets] ${problem}`);
	process.exitCode = 1;
} else {
	console.log(
		"[site-assets] dist/_astro has only the resized banner and avatar",
	);
}
