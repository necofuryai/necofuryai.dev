import assert from "node:assert/strict";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import {
	findPublishingProblems,
	ORIGINALS_DIR,
	prepareSiteAssets,
	readR2Credentials,
	resolveSource,
	SITE_ASSETS,
	sha256Hex,
} from "../../scripts/site-assets.mjs";

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
