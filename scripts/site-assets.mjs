/**
 * バナーとアバターに使う依頼イラストの一覧と、ビルド前に配信用の画像を用意する処理。
 *
 * 原画は公開リポジトリに置かない (.gitignore 済み)。手元では .site-assets/ に置き、
 * Workers Builds では非公開の R2 バケットからビルドのたびに取得する。取得した原画は
 * SHA-256 で照合してから WebP に変換し、src/assets/images/ に書き出す。Astro は
 * import.meta.glob で読み込んだ画像の原本も dist に出力するので、原画の PNG ではなく
 * この WebP を原本にして、可逆の原画が配信されないようにする。
 *
 * 取得元 (SITE_ASSETS_SOURCE):
 * - placeholder: 原画を使わず同じ寸法の仮の画像を書き出す (Workers Builds 以外の既定。
 *                CI、AI エージェント、Workers Builds の本番以外のブランチも必ずこれ)
 * - local:       .site-assets/ の原画を使う (持ち主が手元で明示したときだけ)
 * - r2:          R2 から取得して .site-assets/ に保存する (Workers Builds の本番ブランチでは必須)
 *
 * イラストの利用条件で、生成 AI サービスへの入力が禁止されている。既定を placeholder に
 * しているのは、AI エージェントが実行したビルドやテストの画面に原画が写らないようにする
 * ため (AGENTS.md の "Banner and avatar")。
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "astro/zod";

export const ORIGINALS_DIR = ".site-assets";
export const WEBP_QUALITY = 92;
export const SOURCES = ["local", "r2", "placeholder"];
// Workers Builds の本番ブランチ (ダッシュボードの Settings > Build > Production branch)
export const PRODUCTION_BRANCH = "main";

// バケットは非公開。アカウント ID はリポジトリに置かない方針なので、資格情報と同じく
// 環境変数で受け取る (Workers Builds ではビルド用のシークレット)
export const R2_BUCKET = "necofuryai-dev-site-assets";
export const R2_VARIABLES = [
	"SITE_ASSETS_R2_ACCOUNT_ID",
	"SITE_ASSETS_R2_ACCESS_KEY_ID",
	"SITE_ASSETS_R2_SECRET_ACCESS_KEY",
];

// コミットするのは原画のハッシュと寸法だけ。原画を差し替えたら key と sha256 を更新する
export const SITE_ASSETS = [
	{
		key: "witch-banner.png",
		sha256: "a1eeaa9a7dfe44bb575f81a78130751050bb70d24d1a9a0b4daf6b6cd38ce537",
		width: 3840,
		height: 2160,
		output: "src/assets/images/witch-banner.webp",
	},
	{
		key: "witch-avatar.png",
		sha256: "ff9e29bd9d54189ae8a097cc1f42bb5fb31678e33c3daf7fe7974e266e39efcc",
		width: 1024,
		height: 1024,
		output: "src/assets/images/witch-avatar.webp",
	},
];

/**
 * 取得元を決める。Workers Builds (WORKERS_CI=1) では、本番ブランチなら必ず r2 にして
 * 仮の画像が本番に出ないようにする。本番以外のブランチ (プレビュービルドを有効にした
 * 場合。Dependabot のブランチも含む) では資格情報を使わず、必ず placeholder にする。
 */
export function resolveSource(env) {
	const parsed = z.enum(SOURCES).optional().safeParse(env.SITE_ASSETS_SOURCE);
	if (!parsed.success) {
		throw new Error(
			`SITE_ASSETS_SOURCE must be one of ${SOURCES.join(", ")}, got "${env.SITE_ASSETS_SOURCE}"`,
		);
	}
	if (env.WORKERS_CI !== "1") return parsed.data ?? "placeholder";

	const branch = env.WORKERS_CI_BRANCH;
	if (!branch) {
		throw new Error("WORKERS_CI=1 but WORKERS_CI_BRANCH is not set");
	}
	const required = branch === PRODUCTION_BRANCH ? "r2" : "placeholder";
	if (parsed.data !== undefined && parsed.data !== required) {
		throw new Error(
			`SITE_ASSETS_SOURCE=${parsed.data} is not allowed on Workers Builds for branch "${branch}" (only ${required})`,
		);
	}
	return required;
}

const r2Schema = z.object({
	SITE_ASSETS_R2_ACCOUNT_ID: z
		.string()
		.trim()
		.regex(/^[0-9a-f]{32}$/),
	SITE_ASSETS_R2_ACCESS_KEY_ID: z.string().trim().min(1),
	SITE_ASSETS_R2_SECRET_ACCESS_KEY: z.string().trim().min(1),
});

/**
 * r2 のときに要る接続先と資格情報。足りない・形式が違う変数があれば、その名前を挙げて
 * 止める (値はメッセージに含めない)
 */
export function readR2Credentials(env) {
	const parsed = r2Schema.safeParse(
		Object.fromEntries(R2_VARIABLES.map((name) => [name, env[name]])),
	);
	if (!parsed.success) {
		const invalid = R2_VARIABLES.filter((name) =>
			parsed.error.issues.some((issue) => issue.path[0] === name),
		);
		throw new Error(
			`SITE_ASSETS_SOURCE=r2 needs ${invalid.join(" and ")} (the account ID, and an R2 API token with Object Read only on ${R2_BUCKET}; on Workers Builds, set them as build secrets)`,
		);
	}
	const values = parsed.data;
	return {
		endpoint: `https://${values.SITE_ASSETS_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
		accessKeyId: values.SITE_ASSETS_R2_ACCESS_KEY_ID,
		secretAccessKey: values.SITE_ASSETS_R2_SECRET_ACCESS_KEY,
	};
}

export function sha256Hex(buffer) {
	return createHash("sha256").update(buffer).digest("hex");
}

export function verifyOriginal(asset, buffer) {
	const actual = sha256Hex(buffer);
	if (actual !== asset.sha256) {
		throw new Error(
			`${asset.key}: SHA-256 mismatch (expected ${asset.sha256}, got ${actual})`,
		);
	}
}

/**
 * 途中で止まっても壊れたファイルが残らないよう、一時ファイルに書いてから置き換える。
 * 失敗したら一時ファイルを消す (中身は原画やそこから作った WebP なので残さない)
 */
async function writeAtomic(file, data) {
	await mkdir(path.dirname(file), { recursive: true });
	const temporary = `${file}.${process.pid}.tmp`;
	try {
		await writeFile(temporary, data);
		await rename(temporary, file);
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
}

async function readIfExists(file) {
	try {
		return await readFile(file);
	} catch (error) {
		if (error.code === "ENOENT") return undefined;
		throw error;
	}
}

/** 原画を WebP にする。寸法が一覧と違えば、取り違えとみなして止める */
export async function toWebp(sharp, asset, original) {
	const image = sharp(original);
	const { width, height } = await image.metadata();
	if (width !== asset.width || height !== asset.height) {
		throw new Error(
			`${asset.key}: expected ${asset.width}x${asset.height}, got ${width}x${height}`,
		);
	}
	return image
		.removeAlpha()
		.webp({ quality: WEBP_QUALITY, effort: 4 })
		.toBuffer();
}

/** 原画と同じ寸法の仮の画像。中身はイラストと無関係なグラデーション */
export async function placeholderWebp(sharp, asset) {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${asset.width}" height="${asset.height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9db4e8"/><stop offset="1" stop-color="#d9c8ef"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
	return sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer();
}

/**
 * 一覧の画像をすべて用意する。fetchOriginal(key) は r2 のときだけ呼ばれ、原画の
 * Buffer を返す。書き出す内容が既存のファイルと同じなら書き込まない (dev サーバーの
 * 再読み込みを起こさないため)。
 */
export async function prepareSiteAssets({
	root,
	env,
	sharp,
	fetchOriginal,
	assets = SITE_ASSETS,
	log = () => {},
}) {
	const source = resolveSource(env);
	const results = [];
	for (const asset of assets) {
		let webp;
		if (source === "placeholder") {
			webp = await placeholderWebp(sharp, asset);
		} else {
			const originalPath = path.join(root, ORIGINALS_DIR, asset.key);
			let original = await readIfExists(originalPath);
			if (original !== undefined && sha256Hex(original) !== asset.sha256) {
				if (source === "local") verifyOriginal(asset, original);
				original = undefined; // r2: 古い原画は取り直す
			}
			if (original === undefined) {
				if (source === "local") {
					throw new Error(
						`${path.join(ORIGINALS_DIR, asset.key)} is missing. Put the original there, or run with SITE_ASSETS_SOURCE=r2 and the R2 variables`,
					);
				}
				original = await fetchOriginal(asset.key);
				verifyOriginal(asset, original);
				await writeAtomic(originalPath, original);
			}
			webp = await toWebp(sharp, asset, original);
		}
		const outputPath = path.join(root, asset.output);
		const current = await readIfExists(outputPath);
		const changed = current === undefined || !current.equals(webp);
		if (changed) await writeAtomic(outputPath, webp);
		log(
			`${asset.output} (${source}${changed ? "" : ", unchanged"}, ${webp.length} bytes)`,
		);
		results.push({ output: asset.output, source, changed, bytes: webp.length });
	}
	return results;
}

/**
 * dist/_astro に、配信してはいけない原本が残っていないかを調べる。Astro は原本を
 * バイト単位でそのまま出力するので、ファイル名の形 (ハッシュに "_" が入ることがある)
 * ではなく内容のハッシュで、書き出した WebP と同じものを探す。原本が残る
 * (ImageWrapper が clone を通さずに寸法を読んだときなど) か、変換後の画像が 1 つも
 * 無ければ問題として返す。
 *
 * distFiles: [{ name, sha256 }] (dist/_astro のファイル)
 * outputDigests: { [asset.output]: sha256 } (src/assets/images に書き出した WebP)
 */
export function findPublishingProblems(
	distFiles,
	outputDigests,
	assets = SITE_ASSETS,
) {
	const problems = [];
	for (const asset of assets) {
		const stem = path.basename(asset.output, ".webp");
		const original = outputDigests[asset.output];
		for (const file of distFiles.filter((f) => f.sha256 === original)) {
			problems.push(`original published: dist/_astro/${file.name}`);
		}
		const copies = distFiles.filter(
			(f) => f.name.startsWith(`${stem}.`) && f.sha256 !== original,
		);
		if (copies.length === 0) {
			problems.push(`no resized copy of ${stem} in dist/_astro`);
		}
	}
	return problems;
}
