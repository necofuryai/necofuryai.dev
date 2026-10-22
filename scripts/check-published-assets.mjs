#!/usr/bin/env node
/**
 * astro build の後に、バナーとアバターの原本が dist に残っていないかを確かめる
 * (pnpm build から呼ばれる)。原本が残っても Workers Static Assets は 25 MiB まで
 * 受け付けてそのまま配信するので、ここで止める。判定は scripts/site-assets.mjs の
 * findPublishingProblems を参照。
 *
 * あわせて、SNS 用の画像が dist/og/ に 1200x630 の JPEG として 1 つだけあり、原画や
 * WebP と同じ中身でないことを確かめる (findOgProblems)。どちらも中身はハッシュと
 * 寸法を取るだけで、表示はしない。
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
	distPathOf,
	findOgProblems,
	findPublishingProblems,
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

const ogFiles = {};
const ogDirs = new Set();
for (const asset of SITE_ASSETS) {
	if (asset.og === undefined) continue;
	const published = distPathOf(asset.og.output);
	ogDirs.add(path.posix.dirname(published));
	const data = await readIfExists(path.join(root, published));
	if (data === undefined) continue;
	const prepared = await readIfExists(path.join(root, asset.og.output));
	const { format, width, height } = await sharp(data)
		.metadata()
		.catch(() => ({}));
	ogFiles[asset.og.output] = {
		sha256: sha256Hex(data),
		preparedSha256: prepared && sha256Hex(prepared),
		format,
		width,
		height,
	};
}
const ogEntries = [];
for (const dir of ogDirs) {
	const entries = await readdir(path.join(root, dir)).catch((error) => {
		if (error.code === "ENOENT") return [];
		throw error;
	});
	ogEntries.push(...entries.map((name) => `${dir}/${name}`));
}

const problems = [
	...findPublishingProblems(distFiles, outputDigests),
	...findOgProblems(ogFiles, ogEntries, outputDigests),
];
if (problems.length > 0) {
	for (const problem of problems) console.error(`[site-assets] ${problem}`);
	process.exitCode = 1;
} else {
	console.log(
		"[site-assets] dist/_astro has only the resized banner and avatar, and dist/og/witch-banner.jpg is the 1200x630 JPEG",
	);
}
