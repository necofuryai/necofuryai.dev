/**
 * R2 の S3 互換 API から 1 つのオブジェクトを取得する。
 *
 * 依存を増やさないよう、AWS Signature Version 4 の GET 署名だけを node:crypto で
 * 実装している。署名は AWS の公開テストケース (get-vanilla) で確かめている
 * (tests/unit/r2-object.test.mjs)。資格情報は R2 の API トークン (オブジェクトの
 * 読み取りのみ、バケットを限定) で発行したアクセスキーを使う。
 */
import { createHash, createHmac } from "node:crypto";

const EMPTY_PAYLOAD_SHA256 =
	"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function sha256Hex(value) {
	return createHash("sha256").update(value).digest("hex");
}

function hmac(key, value) {
	return createHmac("sha256", key).update(value).digest();
}

/** RFC 3986 の非予約文字以外を %XX にする (S3 のパスの 1 区切り分。"/" も符号化する) */
export function encodeSegment(segment) {
	return encodeURIComponent(segment).replace(
		/[!'()*]/g,
		(c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
	);
}

/**
 * GET リクエストに付ける署名ヘッダーを返す。headers のキーは小文字で渡す。
 * url のパスは区切りごとに encodeSegment で符号化済みのものを渡す (S3 は正規化した
 * パスを 1 回だけ符号化したものを署名に使うので、ここでは符号化し直さない)。
 * date は Date (テストで固定するため引数にしている)。
 */
export function signGetRequest({
	url,
	headers = {},
	accessKeyId,
	secretAccessKey,
	region,
	service,
	date,
	payloadHash = EMPTY_PAYLOAD_SHA256,
}) {
	const target = new URL(url);
	const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
	const day = amzDate.slice(0, 8);
	const allHeaders = { ...headers, host: target.host, "x-amz-date": amzDate };
	const names = Object.keys(allHeaders).sort();
	const canonicalHeaders = names
		.map((name) => `${name}:${String(allHeaders[name]).trim()}\n`)
		.join("");
	const signedHeaders = names.join(";");
	const query = [...target.searchParams]
		.map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)])
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([k, v]) => `${k}=${v}`)
		.join("&");
	const canonicalRequest = [
		"GET",
		target.pathname,
		query,
		canonicalHeaders,
		signedHeaders,
		payloadHash,
	].join("\n");
	const scope = `${day}/${region}/${service}/aws4_request`;
	const stringToSign = [
		"AWS4-HMAC-SHA256",
		amzDate,
		scope,
		sha256Hex(canonicalRequest),
	].join("\n");
	const signingKey = [day, region, service, "aws4_request"].reduce(
		(key, part) => hmac(key, part),
		`AWS4${secretAccessKey}`,
	);
	const signature = createHmac("sha256", signingKey)
		.update(stringToSign)
		.digest("hex");
	return {
		...allHeaders,
		authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
	};
}

function isRetryable(status) {
	return status === 429 || status >= 500;
}

/**
 * バケットのオブジェクトを Buffer で返す。endpoint は
 * https://<ACCOUNT_ID>.r2.cloudflarestorage.com (パス形式でバケットを指定する)。
 * 通信の失敗 (本文の受信中に切れた場合も含む) と 429・5xx は、attempts 回まで間隔を
 * 倍にしながらやり直す。403 や 404 は設定の誤りなので、すぐに止める。
 */
export async function fetchR2Object({
	endpoint,
	bucket,
	key,
	accessKeyId,
	secretAccessKey,
	fetch = globalThis.fetch,
	now = () => new Date(),
	attempts = 3,
	sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	// 1 回の取得 (本文の受信まで) の上限。止まった接続で Workers Builds の
	// ビルド時間 (20 分) を使い切らないようにする
	timeoutMs = 60_000,
}) {
	const objectPath = [bucket, ...key.split("/")].map(encodeSegment).join("/");
	const url = `${endpoint.replace(/\/$/, "")}/${objectPath}`;
	for (let attempt = 1; ; attempt++) {
		const canRetry = attempt < attempts;
		// やり直しのたびに署名し直す (署名には時刻が入る)
		const headers = signGetRequest({
			url,
			headers: { "x-amz-content-sha256": EMPTY_PAYLOAD_SHA256 },
			accessKeyId,
			secretAccessKey,
			region: "auto",
			service: "s3",
			date: now(),
		});
		delete headers.host; // fetch が付ける
		let response;
		try {
			response = await fetch(url, {
				headers,
				signal: AbortSignal.timeout(timeoutMs),
			});
			// 本文の受信中に切れた場合も、下の catch でやり直す
			if (response.ok) return Buffer.from(await response.arrayBuffer());
		} catch (error) {
			if (!canRetry) {
				throw new Error(
					`R2 request for ${bucket}/${key} failed after ${attempts} attempts`,
					{ cause: error },
				);
			}
			await sleep(500 * 2 ** (attempt - 1));
			continue;
		}
		if (isRetryable(response.status) && canRetry) {
			await response.body?.cancel();
			await sleep(500 * 2 ** (attempt - 1));
			continue;
		}
		// S3 互換のエラーは XML の <Code> に理由が入る (資格情報は含まれない)
		const body = await response.text().catch(() => "");
		const code = body.match(/<Code>([^<]+)<\/Code>/)?.[1] ?? "unknown";
		throw new Error(
			`R2 returned ${response.status} (${code}) for ${bucket}/${key}`,
		);
	}
}
