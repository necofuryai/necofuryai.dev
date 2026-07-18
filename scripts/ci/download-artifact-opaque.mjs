#!/usr/bin/env node
/**
 * Two-phase opaque artifact downloader for the Dependabot advisory `preflight` job.
 * See docs/dependency-update-automation-plan.md section 7.
 *
 * Downloads a GitHub Actions artifact as a single opaque file without extracting
 * or decoding it:
 *
 *   Phase 1: authenticated request to the fixed GitHub API zip endpoint with
 *            automatic redirects disabled. The one expected `302 Location` is
 *            validated (https:, no userinfo, no fragment) before use.
 *   Phase 2: the signed blob URL is fetched exactly once WITHOUT Authorization
 *            or Cookie headers; any further redirect is rejected and the body
 *            is streamed to disk under a hard 100 MiB received-bytes cap.
 *
 * Fails closed: any validation failure exits non-zero and removes the partial
 * output file. On success, prints {"bytes":N,"sha256":"..."} to stdout.
 *
 * Usage: GITHUB_TOKEN=... node scripts/ci/download-artifact-opaque.mjs <artifact_id> <out-file>
 */

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";

const REPO = "necofuryai/necofuryai.dev";
const API_BASE = "https://api.github.com";
const MAX_ARTIFACT_BYTES = 100 * 1024 * 1024; // 100 MiB
const CONNECT_TIMEOUT_MS = 10_000;
const TOTAL_TIMEOUT_MS = 60_000;
const USER_AGENT = "necofuryai-dev-preflight-artifact-downloader";
const ARTIFACT_ID_PATTERN = /^[0-9]+$/;

function fail(message) {
	throw new Error(message);
}

function describeError(error) {
	if (error instanceof Error) {
		const cause =
			error.cause instanceof Error ? `: ${error.cause.message}` : "";
		return `${error.message}${cause}`;
	}
	return String(error);
}

/**
 * Start a fetch with a connect timeout (headers must arrive within
 * CONNECT_TIMEOUT_MS) and a total timeout (the whole request, body included,
 * must finish within TOTAL_TIMEOUT_MS). The caller must invoke `finish()`
 * after fully consuming the response.
 */
function startRequest(url, init) {
	const controller = new AbortController();
	const state = { timeoutReason: null };
	const abortWith = (reason) => {
		state.timeoutReason = reason;
		controller.abort();
	};
	const connectTimer = setTimeout(
		() =>
			abortWith(
				`no response within ${CONNECT_TIMEOUT_MS / 1000}s (connect timeout)`,
			),
		CONNECT_TIMEOUT_MS,
	);
	const totalTimer = setTimeout(
		() =>
			abortWith(`request exceeded ${TOTAL_TIMEOUT_MS / 1000}s (total timeout)`),
		TOTAL_TIMEOUT_MS,
	);
	const finish = () => {
		clearTimeout(connectTimer);
		clearTimeout(totalTimer);
	};
	const responsePromise = (async () => {
		try {
			const response = await fetch(url, { ...init, signal: controller.signal });
			clearTimeout(connectTimer);
			return response;
		} catch (error) {
			finish();
			fail(state.timeoutReason ?? `request failed: ${describeError(error)}`);
		}
	})();
	return { responsePromise, controller, state, finish };
}

async function discardBody(response) {
	try {
		if (response.body !== null) {
			await response.body.cancel();
		}
	} catch {
		// The body is being discarded; cancellation errors are irrelevant.
	}
}

async function fetchArtifactMetadata(artifactId, token) {
	const url = `${API_BASE}/repos/${REPO}/actions/artifacts/${artifactId}`;
	const { responsePromise, state, finish } = startRequest(url, {
		method: "GET",
		redirect: "manual",
		headers: {
			accept: "application/vnd.github+json",
			authorization: `Bearer ${token}`,
			"user-agent": USER_AGENT,
			"x-github-api-version": "2022-11-28",
		},
	});
	try {
		const response = await responsePromise;
		if (response.status !== 200) {
			await discardBody(response);
			fail(
				`artifact metadata request returned HTTP ${response.status} (expected 200)`,
			);
		}
		let metadata;
		try {
			metadata = await response.json();
		} catch (error) {
			fail(
				state.timeoutReason ??
					`artifact metadata is not valid JSON: ${describeError(error)}`,
			);
		}
		if (
			metadata === null ||
			typeof metadata !== "object" ||
			Array.isArray(metadata)
		) {
			fail("artifact metadata is not a JSON object");
		}
		if (
			!Number.isSafeInteger(metadata.id) ||
			String(metadata.id) !== artifactId
		) {
			fail("artifact metadata id does not match the requested artifact id");
		}
		if (metadata.expired !== false) {
			fail("artifact is expired (or the expired flag is missing)");
		}
		const size = metadata.size_in_bytes;
		if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
			fail(
				"artifact metadata size_in_bytes is missing or not a non-negative integer",
			);
		}
		if (size > MAX_ARTIFACT_BYTES) {
			fail(
				`artifact size_in_bytes ${size} exceeds the ${MAX_ARTIFACT_BYTES} byte (100 MiB) limit`,
			);
		}
	} finally {
		finish();
	}
}

/**
 * Phase 1: authenticated request to the fixed zip endpoint, redirects disabled.
 * Returns the validated signed blob URL. The URL is a short-lived capability
 * and must never be logged.
 */
async function resolveSignedLocation(artifactId, token) {
	const url = `${API_BASE}/repos/${REPO}/actions/artifacts/${artifactId}/zip`;
	const { responsePromise, finish } = startRequest(url, {
		method: "GET",
		redirect: "manual",
		headers: {
			accept: "application/vnd.github+json",
			authorization: `Bearer ${token}`,
			"user-agent": USER_AGENT,
			"x-github-api-version": "2022-11-28",
		},
	});
	try {
		const response = await responsePromise;
		await discardBody(response);
		if (response.status !== 302) {
			fail(
				`artifact zip request returned HTTP ${response.status} (expected 302)`,
			);
		}
		const location = response.headers.get("location");
		if (location === null || location === "") {
			fail("artifact zip 302 response is missing a Location header");
		}
		let signedUrl;
		try {
			signedUrl = new URL(location);
		} catch {
			fail("Location header is not an absolute URL");
		}
		if (signedUrl.protocol !== "https:") {
			fail("Location header is not an https: URL");
		}
		if (signedUrl.username !== "" || signedUrl.password !== "") {
			fail("Location header contains userinfo (username/password)");
		}
		if (signedUrl.hash !== "") {
			fail("Location header contains a fragment");
		}
		return signedUrl.href;
	} finally {
		finish();
	}
}

/**
 * Phase 2: fetch the signed URL exactly once, with no credentials attached,
 * and stream the body to `outFile` under the hard received-bytes cap.
 * Returns the number of bytes received.
 */
async function downloadOpaqueBlob(signedUrl, outFile) {
	const { responsePromise, controller, state, finish } = startRequest(
		signedUrl,
		{
			method: "GET",
			redirect: "manual",
			// Deliberately no Authorization and no Cookie header: the signed URL is
			// self-authorizing and must not receive GitHub credentials.
			headers: {
				"user-agent": USER_AGENT,
			},
		},
	);
	let received = 0;
	try {
		const response = await responsePromise;
		if (response.status >= 300 && response.status < 400) {
			await discardBody(response);
			fail(
				`signed URL answered with HTTP ${response.status}; additional redirects are not allowed`,
			);
		}
		if (response.status !== 200) {
			await discardBody(response);
			fail(`signed URL returned HTTP ${response.status} (expected 200)`);
		}
		const declaredLength = response.headers.get("content-length");
		if (declaredLength !== null) {
			const declared = Number(declaredLength);
			if (
				!Number.isSafeInteger(declared) ||
				declared < 0 ||
				declared > MAX_ARTIFACT_BYTES
			) {
				await discardBody(response);
				fail("signed URL declared an invalid or oversize content-length");
			}
		}
		if (response.body === null) {
			fail("signed URL response has no body");
		}
		const capGuard = new Transform({
			transform(chunk, _encoding, callback) {
				received += chunk.byteLength;
				if (received > MAX_ARTIFACT_BYTES) {
					callback(
						new Error(
							`download exceeded the ${MAX_ARTIFACT_BYTES} byte (100 MiB) limit`,
						),
					);
					return;
				}
				callback(null, chunk);
			},
		});
		const writeStream = createWriteStream(outFile, { flags: "wx" });
		try {
			await pipeline(Readable.fromWeb(response.body), capGuard, writeStream);
		} catch (error) {
			controller.abort();
			fail(state.timeoutReason ?? describeError(error));
		}
		return received;
	} finally {
		finish();
	}
}

async function sha256OfFile(filePath) {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(filePath)) {
		hash.update(chunk);
	}
	return hash.digest("hex");
}

export async function downloadArtifactOpaque({ artifactId, outFile, token }) {
	if (typeof artifactId !== "string" || !ARTIFACT_ID_PATTERN.test(artifactId)) {
		fail("artifact_id must consist of decimal digits only");
	}
	if (!Number.isSafeInteger(Number(artifactId))) {
		fail("artifact_id is out of range");
	}
	if (typeof outFile !== "string" || outFile === "") {
		fail("out-file path is required");
	}
	if (typeof token !== "string" || token === "") {
		fail("GITHUB_TOKEN is required and must be non-empty");
	}

	await fetchArtifactMetadata(artifactId, token);
	const signedUrl = await resolveSignedLocation(artifactId, token);
	try {
		const received = await downloadOpaqueBlob(signedUrl, outFile);
		const fileStat = await stat(outFile);
		if (fileStat.size !== received) {
			fail(
				`received byte count (${received}) does not match the file size on disk (${fileStat.size})`,
			);
		}
		if (fileStat.size > MAX_ARTIFACT_BYTES) {
			fail(
				`downloaded file size ${fileStat.size} exceeds the ${MAX_ARTIFACT_BYTES} byte (100 MiB) limit`,
			);
		}
		const sha256 = await sha256OfFile(outFile);
		return { bytes: fileStat.size, sha256 };
	} catch (error) {
		await rm(outFile, { force: true }).catch(() => {});
		throw error;
	}
}

async function main(argv) {
	if (argv.length !== 2) {
		fail(
			"usage: GITHUB_TOKEN=... node scripts/ci/download-artifact-opaque.mjs <artifact_id> <out-file>",
		);
	}
	const [artifactId, outFile] = argv;
	const result = await downloadArtifactOpaque({
		artifactId,
		outFile,
		token: process.env.GITHUB_TOKEN ?? "",
	});
	process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (
	process.argv[1] !== undefined &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	main(process.argv.slice(2)).catch((error) => {
		console.error(
			`download-artifact-opaque: ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exitCode = 1;
	});
}
