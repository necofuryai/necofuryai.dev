import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
	distPathOf,
	findOgProblems,
	findPublishingProblems,
	ORIGINALS_DIR,
	placeholderWebp,
	prepareSiteAssets,
	readR2Credentials,
	resolveSource,
	SITE_ASSETS,
	sha256Hex,
	validateOg,
} from "../../scripts/site-assets.mjs";
import { DEFAULT_OG_IMAGE } from "../../src/utils/og-image.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

// 原画の代わりに、テストの中で作った小さな PNG を使う (依頼イラストは読み込まない)
async function makePng(width, height) {
	return sharp({
		create: { width, height, channels: 3, background: "#336699" },
	})
		.png()
		.toBuffer();
}

async function fixture() {
	const root = await mkdtemp(path.join(tmpdir(), "site-assets-"));
	const png = await makePng(8, 6);
	const asset = {
		key: "sample.png",
		sha256: sha256Hex(png),
		width: 8,
		height: 6,
		output: "src/assets/images/sample.webp",
	};
	return { root, png, asset };
}

test("the manifest lists the banner and the avatar under src/assets/images", () => {
	assert.deepEqual(
		SITE_ASSETS.map((a) => a.output),
		[
			"src/assets/images/witch-banner.webp",
			"src/assets/images/witch-avatar.webp",
		],
	);
	for (const asset of SITE_ASSETS) {
		assert.match(asset.sha256, /^[0-9a-f]{64}$/);
	}
});

test("resolveSource defaults to placeholder outside Workers Builds", () => {
	// AI エージェントが実行するビルドやテストに原画が写らないよう、原画は明示したときだけ
	assert.equal(resolveSource({}), "placeholder");
	assert.equal(resolveSource({ CI: "true" }), "placeholder");
	assert.equal(resolveSource({ SITE_ASSETS_SOURCE: "local" }), "local");
	assert.equal(resolveSource({ SITE_ASSETS_SOURCE: "r2" }), "r2");
	assert.throws(
		() => resolveSource({ SITE_ASSETS_SOURCE: "s3" }),
		/must be one of/,
	);
});

test("resolveSource requires r2 on the Workers Builds production branch", () => {
	const production = { WORKERS_CI: "1", WORKERS_CI_BRANCH: "main" };
	assert.equal(resolveSource(production), "r2");
	assert.equal(
		resolveSource({ ...production, SITE_ASSETS_SOURCE: "r2" }),
		"r2",
	);
	for (const source of ["placeholder", "local"]) {
		assert.throws(
			() => resolveSource({ ...production, SITE_ASSETS_SOURCE: source }),
			/not allowed on Workers Builds for branch "main" \(only r2\)/,
		);
	}
});

test("resolveSource keeps credentials away from Workers Builds preview branches", () => {
	const preview = {
		WORKERS_CI: "1",
		WORKERS_CI_BRANCH: "dependabot/npm_and_yarn/x",
	};
	assert.equal(resolveSource(preview), "placeholder");
	assert.throws(
		() => resolveSource({ ...preview, SITE_ASSETS_SOURCE: "r2" }),
		/only placeholder/,
	);
	assert.throws(
		() => resolveSource({ WORKERS_CI: "1" }),
		/WORKERS_CI_BRANCH is not set/,
	);
});

const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";

test("readR2Credentials names every missing, blank, or malformed variable", () => {
	assert.throws(
		() => readR2Credentials({ SITE_ASSETS_R2_SECRET_ACCESS_KEY: "  " }),
		/needs SITE_ASSETS_R2_ACCOUNT_ID and SITE_ASSETS_R2_ACCESS_KEY_ID and SITE_ASSETS_R2_SECRET_ACCESS_KEY \(/,
	);
	assert.throws(
		() =>
			readR2Credentials({
				SITE_ASSETS_R2_ACCOUNT_ID: "not-an-account-id",
				SITE_ASSETS_R2_ACCESS_KEY_ID: "key-id-value",
				SITE_ASSETS_R2_SECRET_ACCESS_KEY: "secret-value",
			}),
		(error) =>
			/needs SITE_ASSETS_R2_ACCOUNT_ID \(/.test(error.message) &&
			!/not-an-account-id|key-id-value|secret-value/.test(error.message),
	);
});

test("readR2Credentials trims the values and builds the account endpoint", () => {
	assert.deepEqual(
		readR2Credentials({
			SITE_ASSETS_R2_ACCOUNT_ID: ` ${ACCOUNT_ID}\n`,
			SITE_ASSETS_R2_ACCESS_KEY_ID: " id ",
			SITE_ASSETS_R2_SECRET_ACCESS_KEY: "secret\n",
		}),
		{
			endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
			accessKeyId: "id",
			secretAccessKey: "secret",
		},
	);
});

test("local converts a verified original to WebP without fetching", async (t) => {
	const { root, png, asset } = await fixture();
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(path.join(root, ORIGINALS_DIR));
	await writeFile(path.join(root, ORIGINALS_DIR, asset.key), png);

	const [result] = await prepareSiteAssets({
		root,
		env: { SITE_ASSETS_SOURCE: "local" },
		sharp,
		assets: [asset],
		fetchOriginal: () => assert.fail("local must not fetch"),
	});

	assert.equal(result.source, "local");
	const meta = await sharp(path.join(root, asset.output)).metadata();
	assert.deepEqual([meta.format, meta.width, meta.height], ["webp", 8, 6]);
});

test("local fails with a hint when the original is missing", async (t) => {
	const { root, asset } = await fixture();
	t.after(() => rm(root, { recursive: true, force: true }));
	await assert.rejects(
		prepareSiteAssets({
			root,
			env: { SITE_ASSETS_SOURCE: "local" },
			sharp,
			assets: [asset],
			fetchOriginal: () => {},
		}),
		/\.site-assets\/sample\.png is missing.*SITE_ASSETS_SOURCE=r2/,
	);
});

test("local refuses an original whose hash does not match", async (t) => {
	const { root, asset } = await fixture();
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(path.join(root, ORIGINALS_DIR));
	await writeFile(
		path.join(root, ORIGINALS_DIR, asset.key),
		await makePng(8, 7),
	);
	await assert.rejects(
		prepareSiteAssets({
			root,
			env: { SITE_ASSETS_SOURCE: "local" },
			sharp,
			assets: [asset],
			fetchOriginal: () => {},
		}),
		/SHA-256 mismatch/,
	);
});

test("r2 fetches a missing original, verifies it, and caches it", async (t) => {
	const { root, png, asset } = await fixture();
	t.after(() => rm(root, { recursive: true, force: true }));
	const fetched = [];
	const fetchOriginal = async (key) => {
		fetched.push(key);
		return png;
	};

	await prepareSiteAssets({
		root,
		env: { SITE_ASSETS_SOURCE: "r2" },
		sharp,
		assets: [asset],
		fetchOriginal,
	});
	assert.deepEqual(fetched, ["sample.png"]);
	assert.deepEqual(
		await readFile(path.join(root, ORIGINALS_DIR, asset.key)),
		png,
	);

	// 2 回目は保存済みの原画を使い、取りに行かない
	await prepareSiteAssets({
		root,
		env: { SITE_ASSETS_SOURCE: "r2" },
		sharp,
		assets: [asset],
		fetchOriginal,
	});
	assert.deepEqual(fetched, ["sample.png"]);
});

test("r2 refuses a fetched object whose hash does not match", async (t) => {
	const { root, asset } = await fixture();
	t.after(() => rm(root, { recursive: true, force: true }));
	const other = await makePng(8, 7);
	await assert.rejects(
		prepareSiteAssets({
			root,
			env: { SITE_ASSETS_SOURCE: "r2" },
			sharp,
			assets: [asset],
			fetchOriginal: async () => other,
		}),
		/SHA-256 mismatch/,
	);
	await assert.rejects(stat(path.join(root, ORIGINALS_DIR, asset.key)), {
		code: "ENOENT",
	});
});

test("the original must have the dimensions listed in the manifest", async (t) => {
	const { root, asset } = await fixture();
	t.after(() => rm(root, { recursive: true, force: true }));
	const wrong = await makePng(6, 8);
	await assert.rejects(
		prepareSiteAssets({
			root,
			env: { SITE_ASSETS_SOURCE: "r2" },
			sharp,
			assets: [{ ...asset, sha256: sha256Hex(wrong) }],
			fetchOriginal: async () => wrong,
		}),
		/expected 8x6, got 6x8/,
	);
});

test("placeholder writes an image of the same size without touching originals", async (t) => {
	const { root, asset } = await fixture();
	t.after(() => rm(root, { recursive: true, force: true }));
	const [result] = await prepareSiteAssets({
		root,
		env: { SITE_ASSETS_SOURCE: "placeholder" },
		sharp,
		assets: [asset],
		fetchOriginal: () => assert.fail("placeholder must not fetch"),
	});
	assert.equal(result.source, "placeholder");
	const meta = await sharp(path.join(root, asset.output)).metadata();
	assert.deepEqual([meta.format, meta.width, meta.height], ["webp", 8, 6]);
	await assert.rejects(stat(path.join(root, ORIGINALS_DIR)), {
		code: "ENOENT",
	});
});

test("an unchanged output is not rewritten", async (t) => {
	const { root, asset } = await fixture();
	t.after(() => rm(root, { recursive: true, force: true }));
	const env = { SITE_ASSETS_SOURCE: "placeholder" };
	const args = { root, env, sharp, assets: [asset], fetchOriginal: () => {} };
	const [first] = await prepareSiteAssets(args);
	const [second] = await prepareSiteAssets(args);
	assert.equal(first.changed, true);
	assert.equal(second.changed, false);
});

const DIGESTS = {
	"src/assets/images/witch-banner.webp": "a".repeat(64),
	"src/assets/images/witch-avatar.webp": "b".repeat(64),
};

test("findPublishingProblems accepts only resized copies", () => {
	// 実際のビルドで出力された名前の形 (Astro 7.3.8)
	const files = [
		{ name: "witch-banner.D7hRH6Ek_1nlgtV.webp", sha256: "1".repeat(64) },
		{ name: "witch-banner.D7hRH6Ek_tLI3p.webp", sha256: "2".repeat(64) },
		{ name: "witch-avatar.DaQd6CJ1_Z217TDA.webp", sha256: "3".repeat(64) },
	];
	assert.deepEqual(findPublishingProblems(files, DIGESTS), []);
});

test("findPublishingProblems finds an original by content, even with '_' in its hash", () => {
	// Vite のハッシュには "_" が入ることがある (例: Layout.Cc_ZZLyy.css)。名前の形では
	// 変換後の画像と見分けられないので、内容で照合する
	const files = [
		{ name: "witch-banner.Cc_ZZLyy.webp", sha256: "a".repeat(64) },
		{ name: "witch-banner.Cc_ZZLyy_1nlgtV.webp", sha256: "1".repeat(64) },
	];
	assert.deepEqual(findPublishingProblems(files, DIGESTS), [
		"original published: dist/_astro/witch-banner.Cc_ZZLyy.webp",
		"no resized copy of witch-avatar in dist/_astro",
	]);
});

// SNS 用の画像の切り抜きを色で確かめるため、左半分が赤、右半分が青の 16x12 の PNG を使う
async function ogFixture() {
	const root = await mkdtemp(path.join(tmpdir(), "site-assets-og-"));
	const pixels = Buffer.alloc(16 * 12 * 3);
	for (let i = 0; i < 16 * 12; i++) {
		pixels.set(i % 16 < 8 ? [255, 0, 0] : [0, 0, 255], i * 3);
	}
	const png = await sharp(pixels, {
		raw: { width: 16, height: 12, channels: 3 },
	})
		.png()
		.toBuffer();
	const asset = {
		key: "sample.png",
		sha256: sha256Hex(png),
		width: 16,
		height: 12,
		output: "src/assets/images/sample.webp",
		og: {
			output: "public/og/sample.jpg",
			crop: { left: 8, top: 4, width: 8, height: 4 },
			width: 4,
			height: 2,
		},
	};
	return { root, png, asset };
}

test("the banner crops a 1200x630 social image inside the original", () => {
	const [banner, avatar] = SITE_ASSETS;
	const { og } = banner;
	assert.equal(og.output, "public/og/witch-banner.jpg");
	assert.deepEqual([og.width, og.height], [1200, 630]);
	assert.equal(og.crop.width * og.height, og.crop.height * og.width);
	assert.ok(og.crop.left + og.crop.width <= banner.width);
	assert.ok(og.crop.top + og.crop.height <= banner.height);
	for (const asset of SITE_ASSETS) validateOg(asset);
	assert.equal(avatar.og, undefined);
});

test("the social image matches DEFAULT_OG_IMAGE", () => {
	const { og } = SITE_ASSETS[0];
	assert.equal(`public${DEFAULT_OG_IMAGE.path}`, og.output);
	assert.equal(distPathOf(og.output), `dist${DEFAULT_OG_IMAGE.path}`);
	assert.deepEqual(
		[DEFAULT_OG_IMAGE.width, DEFAULT_OG_IMAGE.height, DEFAULT_OG_IMAGE.type],
		[og.width, og.height, "image/jpeg"],
	);
});

test("every prepared file is gitignored", () => {
	const outputs = SITE_ASSETS.flatMap((asset) =>
		asset.og === undefined ? [asset.output] : [asset.output, asset.og.output],
	);
	for (const output of [
		...outputs,
		`${ORIGINALS_DIR}/witch-banner.png`,
		"public/og/witch-banner.jpg.4242.tmp",
	]) {
		const { status } = spawnSync(
			"git",
			["check-ignore", "-q", "--no-index", output],
			{ cwd: repoRoot },
		);
		assert.equal(status, 0, `${output} must be gitignored`);
	}
});

test("validateOg rejects a crop outside the original, a distorting crop, and an upscale", async () => {
	const { asset } = await ogFixture();
	const withOg = (og) => ({ ...asset, og: { ...asset.og, ...og } });
	const crop = (values) => withOg({ crop: { ...asset.og.crop, ...values } });
	assert.throws(() => validateOg(crop({ left: 10 })), /must fit inside 16x12/);
	assert.throws(
		() => validateOg(crop({ height: 3 })),
		/must have the aspect ratio of 4x2/,
	);
	assert.throws(
		() => validateOg(withOg({ width: 16, height: 8 })),
		/must not be smaller than 16x8/,
	);
	assert.throws(() => validateOg(crop({ left: 0.5 })), /must be integers/);
	assert.throws(() => validateOg(crop({ top: -1 })), /non-negative offset/);
	assert.throws(
		() => validateOg(withOg({ output: "public/og/sample.png" })),
		/must be a \.jpg under public\//,
	);
	validateOg(asset);
});

test("a bad crop stops every asset before fetching or writing", async (t) => {
	const { root, asset } = await ogFixture();
	t.after(() => rm(root, { recursive: true, force: true }));
	const plain = { ...asset, key: "plain.png", og: undefined };
	const bad = {
		...asset,
		og: { ...asset.og, crop: { ...asset.og.crop, left: 10 } },
	};
	await assert.rejects(
		prepareSiteAssets({
			root,
			env: { SITE_ASSETS_SOURCE: "r2" },
			sharp,
			assets: [plain, bad],
			fetchOriginal: () => assert.fail("a bad crop must stop before fetching"),
		}),
		/must fit inside 16x12/,
	);
	assert.deepEqual(await readdir(root), []);
});

test("local writes the WebP and the cropped social JPEG from one original", async (t) => {
	const { root, png, asset } = await ogFixture();
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(path.join(root, ORIGINALS_DIR));
	await writeFile(path.join(root, ORIGINALS_DIR, asset.key), png);

	const results = await prepareSiteAssets({
		root,
		env: { SITE_ASSETS_SOURCE: "local" },
		sharp,
		assets: [asset],
		fetchOriginal: () => assert.fail("local must not fetch"),
	});

	assert.deepEqual(
		results.map((r) => r.output),
		[asset.output, asset.og.output],
	);
	const jpg = path.join(root, asset.og.output);
	const meta = await sharp(jpg).metadata();
	assert.deepEqual([meta.format, meta.width, meta.height], ["jpeg", 4, 2]);
	// 右半分 (青) を切り抜いている。左右を縮めただけなら赤が混ざる
	const { channels } = await sharp(jpg).stats();
	assert.ok(channels[0].mean < 60, `red mean ${channels[0].mean}`);
	assert.ok(channels[2].mean > 200, `blue mean ${channels[2].mean}`);
});

test("r2 fetches the original once for both outputs", async (t) => {
	const { root, png, asset } = await ogFixture();
	t.after(() => rm(root, { recursive: true, force: true }));
	const fetched = [];
	const args = {
		root,
		env: { SITE_ASSETS_SOURCE: "r2" },
		sharp,
		assets: [asset],
		fetchOriginal: async (key) => {
			fetched.push(key);
			return png;
		},
	};
	await prepareSiteAssets(args);
	assert.deepEqual(fetched, ["sample.png"]);
	await prepareSiteAssets(args);
	assert.deepEqual(fetched, ["sample.png"]);
	await stat(path.join(root, asset.output));
	await stat(path.join(root, asset.og.output));
});

test("placeholder crops the social image from a same-size placeholder", async (t) => {
	const { root, asset } = await ogFixture();
	t.after(() => rm(root, { recursive: true, force: true }));
	await prepareSiteAssets({
		root,
		env: { SITE_ASSETS_SOURCE: "placeholder" },
		sharp,
		assets: [asset],
		fetchOriginal: () => assert.fail("placeholder must not fetch"),
	});
	const meta = await sharp(path.join(root, asset.og.output)).metadata();
	assert.deepEqual([meta.format, meta.width, meta.height], ["jpeg", 4, 2]);
	// 仮のバナーの WebP は、SNS 用の画像を足す前と同じバイト列のまま
	assert.deepEqual(
		await readFile(path.join(root, asset.output)),
		await placeholderWebp(sharp, asset),
	);
	await assert.rejects(stat(path.join(root, ORIGINALS_DIR)), {
		code: "ENOENT",
	});
});

test("an unchanged social image is not rewritten, and a stale one is", async (t) => {
	const { root, asset } = await ogFixture();
	t.after(() => rm(root, { recursive: true, force: true }));
	const args = {
		root,
		env: { SITE_ASSETS_SOURCE: "placeholder" },
		sharp,
		assets: [asset],
		fetchOriginal: () => {},
	};
	await prepareSiteAssets(args);
	const second = await prepareSiteAssets(args);
	assert.deepEqual(
		second.map((r) => r.changed),
		[false, false],
	);
	await writeFile(path.join(root, asset.og.output), "stale");
	const third = await prepareSiteAssets(args);
	assert.deepEqual(
		third.map((r) => [r.output, r.changed]),
		[
			[asset.output, false],
			[asset.og.output, true],
		],
	);
	assert.deepEqual(await readdir(path.join(root, "public/og")), ["sample.jpg"]);
});

const OG_OUTPUT = "public/og/witch-banner.jpg";
const OG_PUBLISHED = "dist/og/witch-banner.jpg";
const ogFile = (fields) => ({
	sha256: "c".repeat(64),
	preparedSha256: "c".repeat(64),
	format: "jpeg",
	width: 1200,
	height: 630,
	...fields,
});

test("findOgProblems accepts the prepared JPEG", () => {
	assert.deepEqual(
		findOgProblems({ [OG_OUTPUT]: ogFile({}) }, [OG_PUBLISHED], DIGESTS),
		[],
	);
});

test("findOgProblems reports a missing, wrong, copied, or stray file", () => {
	assert.deepEqual(findOgProblems({}, [], DIGESTS), [
		`missing ${OG_PUBLISHED} (scripts/prepare-site-assets.mjs writes ${OG_OUTPUT})`,
	]);
	const original = SITE_ASSETS[0].sha256;
	assert.deepEqual(
		findOgProblems(
			{
				[OG_OUTPUT]: ogFile({
					sha256: original,
					preparedSha256: original,
					format: "png",
					width: 3840,
					height: 2160,
				}),
			},
			[OG_PUBLISHED],
			DIGESTS,
		),
		[
			`original published: ${OG_PUBLISHED}`,
			`${OG_PUBLISHED} is png 3840x2160, expected a 1200x630 JPEG`,
		],
	);
	const webp = DIGESTS["src/assets/images/witch-banner.webp"];
	assert.deepEqual(
		findOgProblems(
			{ [OG_OUTPUT]: ogFile({ sha256: webp, preparedSha256: webp }) },
			[OG_PUBLISHED],
			DIGESTS,
		),
		[`${OG_PUBLISHED} is a copy of src/assets/images/witch-banner.webp`],
	);
	assert.deepEqual(
		findOgProblems(
			{
				[OG_OUTPUT]: ogFile({
					preparedSha256: "d".repeat(64),
					format: undefined,
					width: undefined,
					height: undefined,
				}),
			},
			[OG_PUBLISHED, `${OG_PUBLISHED}.4242.tmp`],
			DIGESTS,
		),
		[
			`${OG_PUBLISHED} is unreadable, expected a 1200x630 JPEG`,
			`${OG_PUBLISHED} differs from ${OG_OUTPUT}`,
			`unexpected file: ${OG_PUBLISHED}.4242.tmp`,
		],
	);
});
