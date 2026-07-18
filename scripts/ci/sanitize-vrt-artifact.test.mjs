/*
 * Offline tests for scripts/ci/sanitize-vrt-artifact.mjs.
 *
 * Run with: node --test scripts/ci/sanitize-vrt-artifact.test.mjs
 *
 * The tests build in-memory fixture ZIPs with a minimal ZIP writer and run
 * the sanitizer as a child process, asserting that hostile archives are
 * rejected (non-zero exit, no sanitized manifest) and that a valid archive
 * with real PNGs passes end-to-end.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import sharp from "sharp";

const SCRIPT_PATH = fileURLToPath(
	new URL("./sanitize-vrt-artifact.mjs", import.meta.url),
);

const tempRoots = [];

after(() => {
	for (const dir of tempRoots) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

function makeTempDir(prefix) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	tempRoots.push(dir);
	return dir;
}

/*
 * Minimal ZIP writer: local file headers + central directory + end of
 * central directory record. Supports stored (0) and deflate (8) entries,
 * UTF-8 names, and custom external attributes (for symlink fixtures).
 */
function buildZip(entries) {
	const localParts = [];
	const centralParts = [];
	let offset = 0;
	for (const entry of entries) {
		const nameBuffer = Buffer.from(entry.name, "utf8");
		const data = entry.data ?? Buffer.alloc(0);
		const method = entry.method ?? 8;
		const compressed = method === 8 ? zlib.deflateRawSync(data) : data;
		const crc = zlib.crc32(data) >>> 0;
		const flags = entry.flags ?? 0x0800;
		const externalAttrs = entry.externalAttrs ?? (0o100644 << 16) >>> 0;

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(flags, 6);
		local.writeUInt16LE(method, 8);
		local.writeUInt16LE(0, 10);
		local.writeUInt16LE(0, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(compressed.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(nameBuffer.length, 26);
		local.writeUInt16LE(0, 28);
		const localHeaderOffset = offset;
		localParts.push(local, nameBuffer, compressed);
		offset += 30 + nameBuffer.length + compressed.length;

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE((3 << 8) | 20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(flags, 8);
		central.writeUInt16LE(method, 10);
		central.writeUInt16LE(0, 12);
		central.writeUInt16LE(0, 14);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(compressed.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(nameBuffer.length, 28);
		central.writeUInt16LE(0, 30);
		central.writeUInt16LE(0, 32);
		central.writeUInt16LE(0, 34);
		central.writeUInt16LE(0, 36);
		central.writeUInt32LE(externalAttrs, 38);
		central.writeUInt32LE(localHeaderOffset, 42);
		centralParts.push(central, nameBuffer);
	}
	const centralDirectory = Buffer.concat(centralParts);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(0, 4);
	eocd.writeUInt16LE(0, 6);
	eocd.writeUInt16LE(entries.length, 8);
	eocd.writeUInt16LE(entries.length, 10);
	eocd.writeUInt32LE(centralDirectory.length, 12);
	eocd.writeUInt32LE(offset, 16);
	eocd.writeUInt16LE(0, 20);
	return Buffer.concat([...localParts, centralDirectory, eocd]);
}

function makeRawDir(zip, manifestOverrides = {}) {
	const dir = makeTempDir("vrt-raw-");
	fs.writeFileSync(path.join(dir, "artifact.zip"), zip);
	const manifest = {
		source_run_id: "123456",
		pr_number: "42",
		head_sha: "a".repeat(40),
		artifact_sha256: createHash("sha256").update(zip).digest("hex"),
		...manifestOverrides,
	};
	fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
	return dir;
}

function runSanitizer(rawDir) {
	const outDir = path.join(makeTempDir("vrt-out-"), "out");
	const result = spawnSync(process.execPath, [SCRIPT_PATH, rawDir, outDir], {
		encoding: "utf8",
	});
	return { result, outDir };
}

function assertRejected({ result, outDir }, messagePattern) {
	assert.notEqual(
		result.status,
		0,
		`expected non-zero exit\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
	);
	assert.equal(
		fs.existsSync(path.join(outDir, "manifest.json")),
		false,
		"rejected input must not produce a sanitized manifest",
	);
	if (messagePattern) {
		assert.match(result.stderr, messagePattern);
	}
}

async function makePng(width, height, background) {
	return sharp({ create: { width, height, channels: 3, background } })
		.png()
		.toBuffer();
}

test("valid artifact with two real PNGs passes end-to-end", async () => {
	const expectedPng = await makePng(32, 32, { r: 255, g: 0, b: 0 });
	const actualPng = await makePng(32, 32, { r: 0, g: 255, b: 0 });
	const zip = buildZip([
		{
			name: "test-results/pages-vrt-home-desktop-light/home-1-expected.png",
			data: expectedPng,
		},
		{
			name: "test-results/pages-vrt-home-desktop-light/home-1-actual.png",
			data: actualPng,
		},
		{
			name: "test-results/pages-vrt-home-desktop-light/trace.zip",
			data: Buffer.from("ignored"),
		},
	]);
	const { result, outDir } = runSanitizer(makeRawDir(zip));
	assert.equal(
		result.status,
		0,
		`stdout: ${result.stdout}\nstderr: ${result.stderr}`,
	);

	const names = fs.readdirSync(outDir).sort();
	assert.deepEqual(names, [
		"home-1-actual.png",
		"home-1-expected.png",
		"manifest.json",
		"summary.txt",
	]);

	const manifest = JSON.parse(
		fs.readFileSync(path.join(outDir, "manifest.json"), "utf8"),
	);
	assert.equal(manifest.source_run_id, "123456");
	assert.equal(manifest.pr_number, "42");
	assert.equal(manifest.head_sha, "a".repeat(40));
	assert.equal(manifest.files.length, 3);
	for (const file of manifest.files) {
		const buffer = fs.readFileSync(path.join(outDir, file.name));
		assert.equal(buffer.length, file.bytes, `bytes mismatch for ${file.name}`);
		assert.equal(
			createHash("sha256").update(buffer).digest("hex"),
			file.sha256,
			`sha256 mismatch for ${file.name}`,
		);
	}

	for (const name of ["home-1-expected.png", "home-1-actual.png"]) {
		const metadata = await sharp(path.join(outDir, name)).metadata();
		assert.equal(metadata.format, "png");
		assert.equal(metadata.width, 32);
		assert.equal(metadata.height, 32);
	}

	const summary = fs.readFileSync(path.join(outDir, "summary.txt"), "utf8");
	assert.match(summary, /pages-vrt-home-desktop-light/);
	assert.match(summary, /excluded_pngs: 0/);
	assert.ok(Buffer.byteLength(summary, "utf8") <= 32 * 1024);
});

test("flattens basename collisions with a numeric suffix", async () => {
	const png = await makePng(8, 8, { r: 0, g: 0, b: 255 });
	const zip = buildZip([
		{
			name: "test-results/pages-vrt-about-desktop-dark/home-expected.png",
			data: png,
		},
		{
			name: "test-results/pages-vrt-home-desktop-dark/home-expected.png",
			data: png,
		},
	]);
	const { result, outDir } = runSanitizer(makeRawDir(zip));
	assert.equal(
		result.status,
		0,
		`stdout: ${result.stdout}\nstderr: ${result.stderr}`,
	);
	const names = fs.readdirSync(outDir).sort();
	assert.deepEqual(names, [
		"home-expected-2.png",
		"home-expected.png",
		"manifest.json",
		"summary.txt",
	]);
});

test("rejects artifact whose SHA-256 does not match the manifest", async () => {
	const png = await makePng(8, 8, { r: 1, g: 2, b: 3 });
	const zip = buildZip([
		{ name: "test-results/pages-vrt-home-desktop-light/x-diff.png", data: png },
	]);
	const rawDir = makeRawDir(zip, { artifact_sha256: "0".repeat(64) });
	assertRejected(runSanitizer(rawDir), /SHA-256 mismatch/);
});

test("rejects path traversal entry (../evil.png)", () => {
	const zip = buildZip([
		{ name: "../evil.png", data: Buffer.from("not a png") },
	]);
	assertRejected(runSanitizer(makeRawDir(zip)), /unsafe path segment/);
});

test("rejects absolute path entry", () => {
	const zip = buildZip([
		{ name: "/evil/home-actual.png", data: Buffer.from("not a png") },
	]);
	assertRejected(runSanitizer(makeRawDir(zip)), /absolute entry path/);
});

test("rejects symlink entry", () => {
	const zip = buildZip([
		{
			name: "test-results/pages-vrt-home-desktop-light/link-expected.png",
			data: Buffer.from("/etc/passwd"),
			externalAttrs: (0o120777 << 16) >>> 0,
		},
	]);
	assertRejected(runSanitizer(makeRawDir(zip)), /symlink entry/);
});

test("rejects zip bomb with compression ratio over 100", () => {
	const zip = buildZip([
		{
			name: "test-results/pages-vrt-home-desktop-light/bomb-actual.png",
			data: Buffer.alloc(1024 * 1024),
		},
	]);
	assertRejected(runSanitizer(makeRawDir(zip)), /compression ratio/);
});

test("rejects archive with more than 500 entries", () => {
	const entries = [];
	for (let i = 0; i < 501; i++) {
		entries.push({ name: `e${i}.txt`, data: Buffer.from("x"), method: 0 });
	}
	const zip = buildZip(entries);
	assertRejected(runSanitizer(makeRawDir(zip)), /entry count/);
});

test("rejects HTML content smuggled as .png", () => {
	const zip = buildZip([
		{
			name: "test-results/pages-vrt-home-desktop-light/fake-diff.png",
			data: Buffer.from("<!doctype html><script>alert(1)</script>"),
		},
	]);
	assertRejected(runSanitizer(makeRawDir(zip)), /unreadable image|not a PNG/);
});

test("rejects PNG wider than 4096 pixels", async () => {
	const widePng = await makePng(4100, 8, { r: 9, g: 9, b: 9 });
	const zip = buildZip([
		{
			name: "test-results/pages-vrt-home-desktop-light/wide-actual.png",
			data: widePng,
		},
	]);
	assertRejected(runSanitizer(makeRawDir(zip)), /width 4100 exceeds/);
});
