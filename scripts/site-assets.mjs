/**
 * バナーとアバターに使う依頼イラストの一覧と、ビルド前に配信用の画像を用意する処理。
 *
 * 原画は公開リポジトリに置かない (.gitignore 済み)。手元では .site-assets/ に置き、
 * Workers Builds では非公開の R2 バケットからビルドのたびに取得する。取得した原画は
 * SHA-256 で照合してから WebP に変換し、src/assets/images/ に書き出す。Astro は
 * import.meta.glob で読み込んだ画像の原本も dist に出力するので、原画の PNG ではなく
 * この WebP を原本にして、可逆の原画が配信されないようにする。
 *
 * バナーからは、SNS で共有したときの画像 (og:image の既定) も同じ原画から作る。原画を
 * og.crop で切り抜いて 1200x630 の JPEG にし、public/og/ に書き出す (Astro がそのまま
 * dist/og/ に写す)。WebP の og:image は LINE・Facebook・Slack で表示がそろわないため JPEG にする。
 * アバターからは、同じように favicon の PNG を作り、public/favicon/ に書き出す。
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
export const OG_JPEG_QUALITY = 85;
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
		// SNS 用の画像 (src/utils/og-image.mjs の DEFAULT_OG_IMAGE と同じパスと寸法)。crop は
		// 原画の座標 (px) で、縦横比は width:height (40:21) と正確に同じにする。全幅で切る
		// (上下 72px だけ落とす)。顔を中心に寄せる候補は { left: 800, top: 330, width: 2240, height: 1176 }
		og: {
			output: "public/og/witch-banner.jpg",
			crop: { left: 0, top: 72, width: 3840, height: 2016 },
			width: 1200,
			height: 630,
		},
	},
	{
		key: "witch-avatar.png",
		sha256: "ff9e29bd9d54189ae8a097cc1f42bb5fb31678e33c3daf7fe7974e266e39efcc",
		width: 1024,
		height: 1024,
		output: "src/assets/images/witch-avatar.webp",
		// favicon (src/utils/favicon.mjs の AVATAR_FAVICONS と同じパスと寸法)。原画を切り抜かずに
		// 正方形のまま縮小する
		favicons: [
			{ output: "public/favicon/witch-avatar-32.png", size: 32 },
			{ output: "public/favicon/witch-avatar-128.png", size: 128 },
			{ output: "public/favicon/witch-avatar-180.png", size: 180 },
			{ output: "public/favicon/witch-avatar-192.png", size: 192 },
		],
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

export async function readIfExists(file) {
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

/** og の指定が原画に収まり、縮小だけで歪まないかを確かめる (取得や変換の前に呼ぶ) */
export function validateOg(asset) {
	const { og } = asset;
	if (og === undefined) return;
	const { crop } = og;
	if (!/^public\/.+\.jpg$/.test(og.output)) {
		throw new Error(
			`${asset.key}: og.output must be a .jpg under public/, got ${og.output}`,
		);
	}
	const numbers = [
		crop.left,
		crop.top,
		crop.width,
		crop.height,
		og.width,
		og.height,
	];
	if (
		!numbers.every(Number.isInteger) ||
		crop.left < 0 ||
		crop.top < 0 ||
		!(crop.width > 0 && crop.height > 0 && og.width > 0 && og.height > 0)
	) {
		throw new Error(
			`${asset.key}: og.crop and the og size must be integers, with positive sizes and a non-negative offset`,
		);
	}
	if (
		crop.left + crop.width > asset.width ||
		crop.top + crop.height > asset.height
	) {
		throw new Error(
			`${asset.key}: og.crop ${crop.width}x${crop.height} at (${crop.left}, ${crop.top}) must fit inside ${asset.width}x${asset.height}`,
		);
	}
	if (crop.width * og.height !== crop.height * og.width) {
		throw new Error(
			`${asset.key}: og.crop ${crop.width}x${crop.height} must have the aspect ratio of ${og.width}x${og.height}`,
		);
	}
	if (crop.width < og.width) {
		throw new Error(
			`${asset.key}: og.crop ${crop.width}x${crop.height} must not be smaller than ${og.width}x${og.height}`,
		);
	}
}

/**
 * favicon の上限 (px)。favicon は可逆の PNG なので、原画に近い大きさで作ると、WebP で
 * 避けている可逆の原画の配信と変わらなくなる。512 は Web アプリのアイコンの最大の寸法
 */
export const FAVICON_MAX_SIZE = 512;

/** favicon の指定が正方形の原画から縮小だけで作れるかを確かめる (取得や変換の前に呼ぶ) */
export function validateFavicons(asset) {
	const { favicons } = asset;
	if (favicons === undefined) return;
	if (asset.width !== asset.height) {
		throw new Error(
			`${asset.key}: favicons need a square original, got ${asset.width}x${asset.height}`,
		);
	}
	const limit = Math.min(asset.width, FAVICON_MAX_SIZE);
	for (const { output, size } of favicons) {
		if (!/^public\/.+\.png$/.test(output)) {
			throw new Error(
				`${asset.key}: favicon output must be a .png under public/, got ${output}`,
			);
		}
		if (!Number.isInteger(size) || size <= 0 || size > limit) {
			throw new Error(
				`${asset.key}: favicon size must be a positive integer up to ${limit}, got ${size}`,
			);
		}
	}
}

/** public/ の出力が dist/ のどこに写るか */
export function distPathOf(output) {
	return `dist/${output.slice("public/".length)}`;
}

/** 原画を og.crop で切り抜き、og.width x og.height の JPEG にする (ベースライン。アルファは WebP と同じく外す) */
export async function toOgJpeg(sharp, asset, original) {
	const { crop, width, height } = asset.og;
	return sharp(original)
		.extract(crop)
		.resize(width, height)
		.removeAlpha()
		.jpeg({ quality: OG_JPEG_QUALITY })
		.toBuffer();
}

/** 原画を size x size の PNG にする (アルファは WebP と同じく外す) */
export async function toFaviconPng(sharp, size, original) {
	return sharp(original).resize(size, size).removeAlpha().png().toBuffer();
}

/**
 * public/ に書き出す画像 (SNS 用の JPEG と favicon の PNG) と、その形式と寸法。
 * check-published-assets.mjs は、dist/ に写ったものをこの一覧と照合する
 */
export function publicOutputsOf(asset) {
	const outputs = [];
	if (asset.og !== undefined) {
		const { output, width, height } = asset.og;
		outputs.push({ output, format: "jpeg", width, height });
	}
	for (const { output, size } of asset.favicons ?? []) {
		outputs.push({ output, format: "png", width: size, height: size });
	}
	return outputs;
}

/**
 * 原画と同じ寸法の仮の原画 (SVG)。中身はイラストと無関係なグラデーション。
 * SNS 用の画像と favicon は、ここから原画と同じ手順で作るので、crop の誤りも CI で止まる
 */
export function placeholderOriginal(asset) {
	return Buffer.from(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${asset.width}" height="${asset.height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9db4e8"/><stop offset="1" stop-color="#d9c8ef"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`,
	);
}

/** 原画と同じ寸法の仮の画像 */
export async function placeholderWebp(sharp, asset) {
	return sharp(placeholderOriginal(asset)).webp({ quality: 80 }).toBuffer();
}

/** local と r2 の原画を、照合してから返す (r2 は .site-assets/ に無いか古いときだけ取得する) */
async function loadOriginal({ root, source, asset, fetchOriginal }) {
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
	return original;
}

/** 中身が同じなら書き込まない (dev サーバーの再読み込みを起こさないため) */
async function writeIfChanged(file, data) {
	const current = await readIfExists(file);
	if (current?.equals(data)) return false;
	await writeAtomic(file, data);
	return true;
}

/**
 * 一覧の画像をすべて用意する。fetchOriginal(key) は r2 のときだけ呼ばれ、原画の
 * Buffer を返す。SNS 用の JPEG と favicon の PNG も同じ原画から作る (r2 でも取得は 1 回)。
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
	// 切り抜き範囲や favicon の寸法の誤りは、取得や変換の前に止める
	for (const asset of assets) {
		validateOg(asset);
		validateFavicons(asset);
	}
	const results = [];
	for (const asset of assets) {
		// 出力をすべて作ってから書き込む (原画の寸法が違えば、何も書かずに止まる)
		const outputs = [];
		let original;
		if (source === "placeholder") {
			original = placeholderOriginal(asset);
			outputs.push([asset.output, await placeholderWebp(sharp, asset)]);
		} else {
			original = await loadOriginal({ root, source, asset, fetchOriginal });
			outputs.push([asset.output, await toWebp(sharp, asset, original)]);
		}
		if (asset.og !== undefined) {
			outputs.push([asset.og.output, await toOgJpeg(sharp, asset, original)]);
		}
		for (const { output, size } of asset.favicons ?? []) {
			outputs.push([output, await toFaviconPng(sharp, size, original)]);
		}
		for (const [output, data] of outputs) {
			const changed = await writeIfChanged(path.join(root, output), data);
			log(
				`${output} (${source}${changed ? "" : ", unchanged"}, ${data.length} bytes)`,
			);
			results.push({ output, source, changed, bytes: data.length });
		}
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

/**
 * dist に写った SNS 用の画像と favicon (publicOutputsOf の一覧) を調べる。無い、原画や
 * WebP と同じ中身、寸法か形式が違う、public/ の版と食い違う、または出力先に別のファイル
 * (止まった実行が残した一時ファイルなど) があれば問題として返す。
 *
 * publicFiles: { [output]: { sha256, preparedSha256, format, width, height } } (dist にあるものだけ)
 * distEntries: 出力先のディレクトリ (dist/og と dist/favicon) にあるファイル ("dist/og/<name>")
 * outputDigests: findPublishingProblems と同じ WebP のハッシュ
 */
export function findPublicProblems(
	publicFiles,
	distEntries,
	outputDigests,
	assets = SITE_ASSETS,
) {
	const problems = [];
	const originals = new Set(assets.map((asset) => asset.sha256));
	const expected = new Set();
	for (const { output, format, width, height } of assets.flatMap(
		publicOutputsOf,
	)) {
		const published = distPathOf(output);
		expected.add(published);
		const file = publicFiles[output];
		if (file === undefined) {
			problems.push(
				`missing ${published} (scripts/prepare-site-assets.mjs writes ${output})`,
			);
			continue;
		}
		if (originals.has(file.sha256)) {
			problems.push(`original published: ${published}`);
		}
		for (const [webp, digest] of Object.entries(outputDigests)) {
			if (digest === file.sha256) {
				problems.push(`${published} is a copy of ${webp}`);
			}
		}
		if (
			file.format !== format ||
			file.width !== width ||
			file.height !== height
		) {
			const actual =
				file.format === undefined
					? "unreadable"
					: `${file.format} ${file.width}x${file.height}`;
			problems.push(
				`${published} is ${actual}, expected a ${width}x${height} ${format.toUpperCase()}`,
			);
		}
		if (file.preparedSha256 !== file.sha256) {
			problems.push(`${published} differs from ${output}`);
		}
	}
	for (const entry of distEntries) {
		if (!expected.has(entry)) problems.push(`unexpected file: ${entry}`);
	}
	return problems;
}
