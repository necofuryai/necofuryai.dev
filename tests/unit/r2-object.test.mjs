import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchR2Object, signGetRequest } from "../../scripts/r2-object.mjs";

// AWS Signature Version 4 の公開テストスイートの資格情報と日時
const SUITE = {
	accessKeyId: "AKIDEXAMPLE",
	secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
	region: "us-east-1",
	service: "service",
	date: new Date("2015-08-30T12:36:00Z"),
};

test("signGetRequest matches the AWS SigV4 get-vanilla test case", () => {
	const headers = signGetRequest({
		...SUITE,
		url: "https://example.amazonaws.com/",
	});
	assert.equal(
		headers.authorization,
		"AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
	);
	assert.equal(headers["x-amz-date"], "20150830T123600Z");
});

test("signGetRequest sorts query parameters like get-vanilla-query-order-key-case", () => {
	const headers = signGetRequest({
		...SUITE,
		url: "https://example.amazonaws.com/?Param2=value2&Param1=value1",
	});
	assert.match(
		headers.authorization,
		/Signature=b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500$/,
	);
});

test("signGetRequest matches the AWS S3 GET Object example with x-amz-content-sha256", () => {
	// Amazon S3 API Reference, "Signature Calculations for the Authorization Header",
	// Example: GET Object
	const headers = signGetRequest({
		url: "https://examplebucket.s3.amazonaws.com/test.txt",
		headers: {
			range: "bytes=0-9",
			"x-amz-content-sha256":
				"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		},
		accessKeyId: "AKIAIOSFODNN7EXAMPLE",
		secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
		region: "us-east-1",
		service: "s3",
		date: new Date("2013-05-24T00:00:00Z"),
	});
	assert.equal(
		headers.authorization,
		"AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
	);
});

test("fetchR2Object encodes the key once in both the URL and the signature", async () => {
	let seen;
	const fetch = async (url, init) => {
		seen = { url, authorization: init.headers.authorization };
		return new Response(new Uint8Array([1]));
	};
	const now = () => new Date("2026-10-22T00:00:00Z");
	await fetchR2Object({
		endpoint: "https://account.r2.cloudflarestorage.com",
		bucket: "bucket",
		key: "dir/witch banner (1).png",
		accessKeyId: "id",
		secretAccessKey: "secret",
		fetch,
		now,
	});
	assert.equal(
		seen.url,
		"https://account.r2.cloudflarestorage.com/bucket/dir/witch%20banner%20%281%29.png",
	);
	// 同じ URL を署名し直した結果と一致する (= パスを符号化し直していない)
	const expected = signGetRequest({
		url: seen.url,
		headers: {
			"x-amz-content-sha256":
				"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		},
		accessKeyId: "id",
		secretAccessKey: "secret",
		region: "auto",
		service: "s3",
		date: now(),
	});
	assert.equal(seen.authorization, expected.authorization);
});

test("fetchR2Object signs a path-style GET for the auto region", async () => {
	const calls = [];
	const fetch = async (url, init) => {
		calls.push({ url, headers: init.headers });
		return new Response(new Uint8Array([1, 2, 3]));
	};
	const body = await fetchR2Object({
		endpoint: "https://account.r2.cloudflarestorage.com/",
		bucket: "bucket",
		key: "witch-banner.png",
		accessKeyId: "id",
		secretAccessKey: "secret",
		fetch,
		now: () => new Date("2026-10-22T00:00:00Z"),
	});

	assert.deepEqual([...body], [1, 2, 3]);
	assert.equal(
		calls[0].url,
		"https://account.r2.cloudflarestorage.com/bucket/witch-banner.png",
	);
	const { headers } = calls[0];
	assert.equal(headers.host, undefined);
	assert.equal(headers["x-amz-date"], "20261022T000000Z");
	assert.match(
		headers.authorization,
		/^AWS4-HMAC-SHA256 Credential=id\/20261022\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
	);
	assert.doesNotMatch(JSON.stringify(headers), /secret/);
});

test("fetchR2Object reports the S3 error code without the credentials", async () => {
	const fetch = async () =>
		new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 });
	await assert.rejects(
		fetchR2Object({
			endpoint: "https://account.r2.cloudflarestorage.com",
			bucket: "bucket",
			key: "witch-avatar.png",
			accessKeyId: "id",
			secretAccessKey: "secret",
			fetch,
		}),
		(error) => {
			assert.equal(
				error.message,
				"R2 returned 403 (AccessDenied) for bucket/witch-avatar.png",
			);
			return true;
		},
	);
});

const TARGET = {
	endpoint: "https://account.r2.cloudflarestorage.com",
	bucket: "bucket",
	key: "witch-avatar.png",
	accessKeyId: "id",
	secretAccessKey: "secret",
};

test("fetchR2Object retries 5xx with backoff, then returns the body", async () => {
	const statuses = [503, 500, 200];
	const sleeps = [];
	const body = await fetchR2Object({
		...TARGET,
		fetch: async () => {
			const status = statuses.shift();
			return new Response(status === 200 ? new Uint8Array([7]) : "busy", {
				status,
			});
		},
		sleep: async (ms) => sleeps.push(ms),
	});
	assert.deepEqual([...body], [7]);
	assert.deepEqual(sleeps, [500, 1000]);
});

test("fetchR2Object retries when the body stream breaks", async () => {
	let calls = 0;
	const body = await fetchR2Object({
		...TARGET,
		fetch: async () => {
			calls++;
			if (calls === 1) {
				const broken = new ReadableStream({
					start(controller) {
						controller.error(new TypeError("terminated"));
					},
				});
				return new Response(broken);
			}
			return new Response(new Uint8Array([9]));
		},
		sleep: async () => {},
	});
	assert.deepEqual([...body], [9]);
	assert.equal(calls, 2);
});

test("fetchR2Object gives each attempt a timeout and retries after it fires", async () => {
	const signals = [];
	const body = await fetchR2Object({
		...TARGET,
		timeoutMs: 5,
		fetch: (_url, init) => {
			signals.push(init.signal);
			if (signals.length === 1) {
				// 応答しない接続の代わり。タイムアウトで中断されるまで待つ
				return new Promise((_, reject) =>
					init.signal.addEventListener("abort", () =>
						reject(init.signal.reason),
					),
				);
			}
			return Promise.resolve(new Response(new Uint8Array([5])));
		},
		sleep: async () => {},
	});
	assert.deepEqual([...body], [5]);
	assert.equal(signals.length, 2);
	assert.equal(signals[0].reason.name, "TimeoutError");
	assert.notEqual(signals[0], signals[1]);
});

test("fetchR2Object does not retry a 403", async () => {
	let calls = 0;
	await assert.rejects(
		fetchR2Object({
			...TARGET,
			fetch: async () => {
				calls++;
				return new Response("<Error><Code>AccessDenied</Code></Error>", {
					status: 403,
				});
			},
			sleep: async () => assert.fail("must not wait"),
		}),
		/403 \(AccessDenied\)/,
	);
	assert.equal(calls, 1);
});

test("fetchR2Object gives up after the last attempt and keeps the network error", async () => {
	const failure = new TypeError("fetch failed");
	let calls = 0;
	await assert.rejects(
		fetchR2Object({
			...TARGET,
			fetch: async () => {
				calls++;
				throw failure;
			},
			sleep: async () => {},
		}),
		(error) =>
			error.cause === failure &&
			/bucket\/witch-avatar\.png failed after 3 attempts/.test(error.message),
	);
	assert.equal(calls, 3);
});
