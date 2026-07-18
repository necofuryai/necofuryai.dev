/**
 * Tests for scripts/ci/download-artifact-opaque.mjs.
 *
 * `globalThis.fetch` is stubbed so that the https: URLs the downloader builds
 * (api.github.com and the signed blob host) are served by a local node:http
 * server. The downloader's own validation still sees the original https: URLs.
 */

import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { downloadArtifactOpaque } from "./download-artifact-opaque.mjs";

const ARTIFACT_ID = "123456";
const TOKEN = "test-token";
const API_PREFIX = `/repos/necofuryai/necofuryai.dev/actions/artifacts/${ARTIFACT_ID}`;
const SIGNED_PATH = "/signed/artifact.zip";
const SIGNED_URL = `https://blob.invalid${SIGNED_PATH}?sig=test`;

const realFetch = globalThis.fetch;
const seenRequests = [];
let server;
let handler;

const workDir = mkdtempSync(join(tmpdir(), "artifact-opaque-test-"));
let fileCounter = 0;

function nextOutFile() {
	fileCounter += 1;
	return join(workDir, `artifact-${fileCounter}.zip`);
}

function respondMetadata(res, overrides = {}) {
	res.writeHead(200, { "content-type": "application/json" });
	res.end(
		JSON.stringify({
			id: Number(ARTIFACT_ID),
			expired: false,
			size_in_bytes: 1024,
			...overrides,
		}),
	);
}

function installHandler({ metadata, zip, signed }) {
	handler = (req, res) => {
		const { pathname } = new URL(req.url, "http://localhost");
		if (pathname === `${API_PREFIX}/zip`) {
			zip(req, res);
			return;
		}
		if (pathname === API_PREFIX) {
			(metadata ?? ((_req, metadataRes) => respondMetadata(metadataRes)))(
				req,
				res,
			);
			return;
		}
		if (pathname === SIGNED_PATH) {
			if (signed === undefined) {
				assert.fail("unexpected request to the signed URL");
			}
			signed(req, res);
			return;
		}
		res.writeHead(404);
		res.end();
	};
}

before(async () => {
	server = createServer((req, res) => {
		seenRequests.push({ url: req.url, headers: { ...req.headers } });
		req.on("error", () => {});
		res.on("error", () => {});
		handler(req, res);
	});
	await new Promise((resolve) => {
		server.listen(0, "127.0.0.1", resolve);
	});
	const { port } = server.address();
	const localOrigin = `http://127.0.0.1:${port}`;
	globalThis.fetch = (input, init) => {
		const url = new URL(typeof input === "string" ? input : input.url);
		assert.equal(
			url.protocol,
			"https:",
			"downloader must only request https: URLs",
		);
		return realFetch(`${localOrigin}${url.pathname}${url.search}`, init);
	};
});

after(async () => {
	globalThis.fetch = realFetch;
	server.closeAllConnections();
	await new Promise((resolve) => {
		server.close(resolve);
	});
	await rm(workDir, { recursive: true, force: true });
});

beforeEach(() => {
	seenRequests.length = 0;
	handler = () => {
		assert.fail("test did not install a request handler");
	};
});

test("rejects a 302 Location containing userinfo", async () => {
	const outFile = nextOutFile();
	installHandler({
		zip: (_req, res) => {
			res.writeHead(302, {
				location: "https://user:secret@blob.invalid/signed/artifact.zip",
			});
			res.end();
		},
	});
	await assert.rejects(
		downloadArtifactOpaque({ artifactId: ARTIFACT_ID, outFile, token: TOKEN }),
		/userinfo/,
	);
	assert.equal(existsSync(outFile), false);
});

test("rejects a non-302 response from the zip endpoint", async () => {
	const outFile = nextOutFile();
	installHandler({
		zip: (_req, res) => {
			res.writeHead(200, { "content-type": "application/zip" });
			res.end("PKnot-a-redirect");
		},
	});
	await assert.rejects(
		downloadArtifactOpaque({ artifactId: ARTIFACT_ID, outFile, token: TOKEN }),
		/expected 302/,
	);
	assert.equal(existsSync(outFile), false);
});

test("rejects a second redirect from the signed URL", async () => {
	const outFile = nextOutFile();
	installHandler({
		zip: (_req, res) => {
			res.writeHead(302, { location: SIGNED_URL });
			res.end();
		},
		signed: (_req, res) => {
			res.writeHead(302, { location: "https://elsewhere.invalid/next.zip" });
			res.end();
		},
	});
	await assert.rejects(
		downloadArtifactOpaque({ artifactId: ARTIFACT_ID, outFile, token: TOKEN }),
		/additional redirects are not allowed/,
	);
	assert.equal(existsSync(outFile), false);
});

test("aborts an oversize body and removes the partial file", async () => {
	const outFile = nextOutFile();
	installHandler({
		zip: (_req, res) => {
			res.writeHead(302, { location: SIGNED_URL });
			res.end();
		},
		signed: (_req, res) => {
			// No content-length: chunked transfer, so only the streaming
			// received-bytes cap can stop this lying server.
			res.writeHead(200, { "content-type": "application/zip" });
			const chunk = Buffer.alloc(4 * 1024 * 1024, 0x41);
			const target = 101 * 1024 * 1024;
			let sent = 0;
			const writeMore = () => {
				while (sent < target) {
					if (res.destroyed || res.writableEnded) {
						return;
					}
					sent += chunk.length;
					if (!res.write(chunk)) {
						res.once("drain", writeMore);
						return;
					}
				}
				res.end();
			};
			writeMore();
		},
	});
	await assert.rejects(
		downloadArtifactOpaque({ artifactId: ARTIFACT_ID, outFile, token: TOKEN }),
		/100 MiB/,
	);
	assert.equal(existsSync(outFile), false);
});

test("happy path writes the file and reports bytes and sha256", async () => {
	const outFile = nextOutFile();
	const body = Buffer.alloc(256 * 1024);
	for (let i = 0; i < body.length; i += 1) {
		body[i] = i % 251;
	}
	const expectedSha256 = createHash("sha256").update(body).digest("hex");
	installHandler({
		metadata: (_req, res) =>
			respondMetadata(res, { size_in_bytes: body.length }),
		zip: (_req, res) => {
			res.writeHead(302, { location: SIGNED_URL });
			res.end();
		},
		signed: (_req, res) => {
			res.writeHead(200, {
				"content-type": "application/zip",
				"content-length": String(body.length),
			});
			res.end(body);
		},
	});
	const result = await downloadArtifactOpaque({
		artifactId: ARTIFACT_ID,
		outFile,
		token: TOKEN,
	});
	assert.deepEqual(result, { bytes: body.length, sha256: expectedSha256 });
	assert.ok(
		readFileSync(outFile).equals(body),
		"file on disk must match the served body",
	);

	const zipRequest = seenRequests.find(
		(entry) => entry.url === `${API_PREFIX}/zip`,
	);
	assert.ok(zipRequest, "zip endpoint must have been requested");
	assert.equal(zipRequest.headers.authorization, `Bearer ${TOKEN}`);

	const signedRequest = seenRequests.find((entry) =>
		entry.url.startsWith(SIGNED_PATH),
	);
	assert.ok(signedRequest, "signed URL must have been requested");
	assert.equal(
		signedRequest.headers.authorization,
		undefined,
		"no Authorization on the signed URL",
	);
	assert.equal(
		signedRequest.headers.cookie,
		undefined,
		"no Cookie on the signed URL",
	);
});
