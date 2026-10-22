#!/usr/bin/env node
/**
 * astro build の後に、バナーとアバターの原本が dist に残っていないかを確かめる
 * (pnpm build から呼ばれる)。原本が残っても Workers Static Assets は 25 MiB まで
 * 受け付けてそのまま配信するので、ここで止める。判定は scripts/site-assets.mjs の
 * findPublishingProblems を参照。
 *
 * あわせて、SNS 用の画像 (dist/og/ の 1200x630 の JPEG) と favicon (dist/favicon/ の
 * 正方形の PNG) が一覧どおりにだけあり、原画や WebP と同じ中身でないことを確かめる
 * (findPublicProblems)。どちらも中身はハッシュと寸法を取るだけで、表示はしない。
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
	distPathOf,
	findPublicProblems,
	findPublishingProblems,
	publicOutputsOf,
	readIfExists,
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

const publicFiles = {};
const publicDirs = new Set();
for (const { output } of SITE_ASSETS.flatMap(publicOutputsOf)) {
	const published = distPathOf(output);
	publicDirs.add(path.posix.dirname(published));
	const data = await readIfExists(path.join(root, published));
	if (data === undefined) continue;
	const prepared = await readIfExists(path.join(root, output));
	const { format, width, height } = await sharp(data)
		.metadata()
		.catch(() => ({}));
	publicFiles[output] = {
		sha256: sha256Hex(data),
		preparedSha256: prepared && sha256Hex(prepared),
		format,
		width,
		height,
	};
}
const publicEntries = [];
for (const dir of publicDirs) {
	const entries = await readdir(path.join(root, dir)).catch((error) => {
		if (error.code === "ENOENT") return [];
		throw error;
	});
	publicEntries.push(...entries.map((name) => `${dir}/${name}`));
}

const problems = [
	...findPublishingProblems(distFiles, outputDigests),
	...findPublicProblems(publicFiles, publicEntries, outputDigests),
];
if (problems.length > 0) {
	for (const problem of problems) console.error(`[site-assets] ${problem}`);
	process.exitCode = 1;
} else {
	console.log(
		"[site-assets] dist/_astro has only the resized banner and avatar, and dist/og and dist/favicon hold only the prepared social image and favicons",
	);
}
