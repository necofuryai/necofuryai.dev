#!/usr/bin/env node
/**
 * dev と build の前に、バナーとアバターの WebP を src/assets/images/ に、バナーから
 * 切り抜いた SNS 用の JPEG (og:image の既定) を public/og/ に、アバターを縮小した
 * favicon の PNG を public/favicon/ に書き出す。
 * 取得元と仕組みは scripts/site-assets.mjs の冒頭のコメントを参照。
 *
 * 実行: pnpm site-assets (pnpm dev / pnpm build からも呼ばれる)
 * - 既定 (Workers Builds 以外): 同じ寸法の仮の画像。CI と AI エージェントはこのまま使う
 * - 持ち主が手元で原画を使うとき: .site-assets/ に原画を置き、SITE_ASSETS_SOURCE=local
 *   (原画が無ければ SITE_ASSETS_SOURCE=r2 と R2 の 3 つの変数で取得する)
 * - Workers Builds の本番ブランチ (main): r2 になり、ビルド用のシークレットを使う。
 *   それ以外のブランチは placeholder
 *
 * ログには出力先・取得元・バイト数だけを出し、資格情報は出さない (通信に失敗したときは
 * 原因のエラーも出す。Workers Builds のログは非公開)。
 */
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { fetchR2Object } from "./r2-object.mjs";
import {
	prepareSiteAssets,
	R2_BUCKET,
	readR2Credentials,
	resolveSource,
} from "./site-assets.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

try {
	const source = resolveSource(process.env);
	// 資格情報が要るときは、変換を始める前に足りない変数を報告して止める
	const credentials =
		source === "r2" ? readR2Credentials(process.env) : undefined;
	if (
		source === "placeholder" &&
		process.env.SITE_ASSETS_SOURCE === undefined
	) {
		console.log(
			"[site-assets] using placeholders (set SITE_ASSETS_SOURCE=local to build with the originals in .site-assets/)",
		);
	}
	await prepareSiteAssets({
		root,
		env: process.env,
		sharp,
		fetchOriginal: (key) =>
			fetchR2Object({ ...credentials, bucket: R2_BUCKET, key }),
		log: (message) => console.log(`[site-assets] ${message}`),
	});
} catch (error) {
	console.error(`[site-assets] ${error.message}`);
	if (error.cause) console.error(error.cause);
	process.exitCode = 1;
}
