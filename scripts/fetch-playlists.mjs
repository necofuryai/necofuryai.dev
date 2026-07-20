#!/usr/bin/env node
/**
 * Apple Music API からプレイリストデータを取得し src/data/playlists/*.json に書き出す。
 *
 * 必要な環境変数 (Apple Developer Program の資格情報。.env に置けば自動で読み込まれる):
 * - APPLE_MUSIC_TEAM_ID:    Apple Developer の Team ID
 * - APPLE_MUSIC_KEY_ID:     Media ID 用に作成したキーの Key ID
 * - APPLE_MUSIC_PRIVATE_KEY: .p8 秘密鍵の中身 (PEM 全文。改行は実改行でも "\n" 表記でもよい)
 *
 * 実行: pnpm fetch-playlists (全件) / pnpm fetch-playlists --weekly (週次更新分のみ)
 *
 * developer token は実行のたびに 1 時間有効のものを ES256 で署名生成するため、
 * 長期トークンの保管やローテーション運用は発生しない。
 * ビルドの決定性を保つため、意図的に pnpm build には組み込んでいない。
 * 失敗したプレイリストは既存 JSON を保持し、対象が全滅した場合のみ exit 1 で終了する。
 * fetchedAt 以外に変更がないプレイリストは書き込みをスキップする
 * (週次 CI が無意味な diff で PR を作らないようにするため)。
 */
import { execFileSync } from "node:child_process";
import { createPrivateKey, sign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "astro/zod";
import { isSamePlaylistContent, selectPlaylists } from "./playlist-utils.mjs";

// weekly: Apple が毎週日曜に更新するのは Replay All Time と現行年のみで、
// 過去年は凍結されるため週次 CI (--weekly) では取得しない。
// 年替わり時は PLAYLISTS の入替とあわせて weekly の付け替えも行うこと。
const PLAYLISTS = [
	{
		slug: "replay-all-time",
		id: "pl.rp-M9CMY0pYR",
		storefront: "jp",
		weekly: true,
	},
	{
		slug: "replay-2026",
		id: "pl.rp-lellcVyY1yj",
		storefront: "jp",
		weekly: true,
	},
	{ slug: "replay-2025", id: "pl.rp-55w5t6NGXNj", storefront: "jp" },
	{ slug: "replay-2024", id: "pl.rp-3g58tjR0VRD", storefront: "jp" },
];

const API_ORIGIN = "https://api.music.apple.com";
const OUT_DIR = new URL("../src/data/playlists/", import.meta.url);
const TOKEN_TTL_SECONDS = 60 * 60;

// コミットされる JSON はそのまま href / img src / style 属性に描画されるため、
// スキーマの段階で「https の Apple 系ドメイン」「16 進カラー」に制約して信頼性を作り込む
const ALLOWED_URL_HOSTS = [
	"music.apple.com",
	".apple.com",
	".mzstatic.com",
	".itunes.apple.com",
];
const appleUrl = z.string().refine(
	(value) => {
		try {
			const url = new URL(value);
			return (
				url.protocol === "https:" &&
				ALLOWED_URL_HOSTS.some((host) =>
					host.startsWith(".")
						? url.hostname.endsWith(host)
						: url.hostname === host,
				)
			);
		} catch {
			return false;
		}
	},
	{ message: "https の Apple 系ドメイン URL ではありません" },
);
const hexColor = z.string().regex(/^[0-9a-fA-F]{6,8}$/);

const artworkSchema = z.object({
	url: appleUrl,
	width: z.number(),
	height: z.number(),
	bgColor: hexColor.optional(),
	textColor1: hexColor.optional(),
	textColor2: hexColor.optional(),
	textColor3: hexColor.optional(),
	textColor4: hexColor.optional(),
});

// 曲 (songs) と music-videos で属性名は共通なので type では絞らない
const trackItemSchema = z.object({
	id: z.string(),
	attributes: z.object({
		name: z.string(),
		artistName: z.string(),
		albumName: z.string().optional(),
		durationInMillis: z.number().optional(),
		url: appleUrl.optional(),
		previews: z.array(z.object({ url: appleUrl.optional() })).optional(),
		artwork: artworkSchema.optional(),
	}),
});

const tracksPageSchema = z.object({
	data: z.array(trackItemSchema),
	next: z.string().optional(),
});

const playlistResponseSchema = z.object({
	data: z
		.array(
			z.object({
				id: z.string(),
				attributes: z.object({
					name: z.string(),
					curatorName: z.string().optional(),
					description: z.object({ standard: z.string().optional() }).optional(),
					url: appleUrl.optional(),
					artwork: artworkSchema.optional(),
				}),
				relationships: z
					.object({ tracks: tracksPageSchema.optional() })
					.optional(),
			}),
		)
		.min(1),
});

function base64UrlEncode(input) {
	return Buffer.from(input).toString("base64url");
}

function createDeveloperToken() {
	const teamId = process.env.APPLE_MUSIC_TEAM_ID;
	const keyId = process.env.APPLE_MUSIC_KEY_ID;
	const privateKeyPem = process.env.APPLE_MUSIC_PRIVATE_KEY?.replace(
		/\\n/g,
		"\n",
	);
	if (!teamId || !keyId || !privateKeyPem) {
		throw new Error(
			"APPLE_MUSIC_TEAM_ID / APPLE_MUSIC_KEY_ID / APPLE_MUSIC_PRIVATE_KEY が未設定です。" +
				"Apple Developer で作成した Media ID キー (.p8) の値を環境変数か .env に設定してください。",
		);
	}
	const issuedAt = Math.floor(Date.now() / 1000);
	const header = base64UrlEncode(
		JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }),
	);
	const payload = base64UrlEncode(
		JSON.stringify({
			iss: teamId,
			iat: issuedAt,
			exp: issuedAt + TOKEN_TTL_SECONDS,
		}),
	);
	const signingInput = `${header}.${payload}`;
	// JWS (ES256) は DER ではなく r||s 連結の生署名を要求するため ieee-p1363 を指定する
	const signature = sign("sha256", Buffer.from(signingInput), {
		key: createPrivateKey(privateKeyPem),
		dsaEncoding: "ieee-p1363",
	});
	return `${signingInput}.${base64UrlEncode(signature)}`;
}

async function fetchJson(url, token) {
	for (let attempt = 0; ; attempt++) {
		const response = await fetch(url, {
			headers: { Authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(30_000),
		});
		if (response.ok) {
			return response.json();
		}
		// 公式レート制限は約 20 calls/分。429 と 5xx のみ一度だけ再試行する
		if ((response.status === 429 || response.status >= 500) && attempt === 0) {
			await new Promise((resolve) => setTimeout(resolve, 3_000));
			continue;
		}
		const body = await response.text();
		throw new Error(
			`HTTP ${response.status} ${response.statusText}: ${body.slice(0, 300)} (${url})`,
		);
	}
}

function toArtwork(artwork) {
	if (!artwork) {
		return null;
	}
	return {
		urlTemplate: artwork.url,
		width: artwork.width,
		height: artwork.height,
		bgColor: artwork.bgColor ?? null,
		textColors: [
			artwork.textColor1,
			artwork.textColor2,
			artwork.textColor3,
			artwork.textColor4,
		].filter((color) => typeof color === "string"),
	};
}

function toTrack(item) {
	const { attributes } = item;
	return {
		id: item.id,
		title: attributes.name,
		artist: attributes.artistName,
		album: attributes.albumName ?? null,
		durationMs: attributes.durationInMillis ?? null,
		url: attributes.url ?? null,
		previewUrl: attributes.previews?.[0]?.url ?? null,
		artworkUrlTemplate: attributes.artwork?.url ?? null,
	};
}

async function fetchPlaylist({ id, storefront }, order, token) {
	const playlistUrl = `${API_ORIGIN}/v1/catalog/${storefront}/playlists/${id}`;
	const response = playlistResponseSchema.parse(
		await fetchJson(playlistUrl, token),
	);
	const playlist = response.data[0];
	const tracksRelationship = playlist.relationships?.tracks;
	if (!tracksRelationship) {
		throw new Error(`レスポンスに tracks relationship がありません (${id})`);
	}
	const items = [...tracksRelationship.data];
	let next = tracksRelationship.next;
	while (next) {
		// 文字列連結だと "@evil.example/x" のような値で宛先ホストがすり替わるため、
		// URL として解決して origin が API と一致することを検証する
		const nextUrl = new URL(next, API_ORIGIN);
		if (nextUrl.origin !== API_ORIGIN) {
			throw new Error(`不正なページネーション URL です: ${next}`);
		}
		const page = tracksPageSchema.parse(await fetchJson(nextUrl.href, token));
		items.push(...page.data);
		next = page.next;
	}
	const { attributes } = playlist;
	return {
		placeholder: false,
		order,
		fetchedAt: new Date().toISOString(),
		id,
		storefront,
		name: attributes.name,
		curator: attributes.curatorName ?? null,
		description: attributes.description?.standard ?? null,
		url:
			attributes.url ?? `https://music.apple.com/${storefront}/playlist/${id}`,
		embedUrl: `https://embed.music.apple.com/${storefront}/playlist/${id}`,
		artwork: toArtwork(attributes.artwork),
		tracks: items.map(toTrack),
	};
}

const token = createDeveloperToken();
const targets = selectPlaylists(PLAYLISTS, {
	weeklyOnly: process.argv.includes("--weekly"),
});
const failures = [];
for (const { playlist, order } of targets) {
	try {
		const data = await fetchPlaylist(playlist, order, token);
		const outFile = new URL(`${playlist.slug}.json`, OUT_DIR);
		const existing = await readFile(outFile, "utf8")
			.then(JSON.parse)
			.catch(() => null);
		if (isSamePlaylistContent(existing, data)) {
			console.log(
				`OK ${playlist.slug}: 変更なし (fetchedAt のみ)。書き込みをスキップします。`,
			);
			continue;
		}
		await writeFile(outFile, `${JSON.stringify(data, null, "\t")}\n`);
		console.log(`OK ${playlist.slug}: ${data.tracks.length} 曲 (${data.name})`);
	} catch (error) {
		failures.push(playlist.slug);
		console.error(
			`NG ${playlist.slug}: 取得に失敗。既存の JSON を保持します。`,
		);
		console.error(error instanceof Error ? error.message : error);
	}
}
// JSON.stringify のタブ整形は Biome スタイル (行幅に収まる配列の 1 行化など) と
// 一致せず CI の Biome チェックが落ちるため、書き出し後にここで整形まで済ませる
execFileSync(
	fileURLToPath(new URL("../node_modules/.bin/biome", import.meta.url)),
	["format", "--write", fileURLToPath(OUT_DIR)],
	{ stdio: "inherit", cwd: fileURLToPath(new URL("../", import.meta.url)) },
);

if (targets.length > 0 && failures.length === targets.length) {
	process.exitCode = 1;
}
