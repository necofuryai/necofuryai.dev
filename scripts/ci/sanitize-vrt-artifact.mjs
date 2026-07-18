/*
 * Credentialless sanitizer for Playwright VRT failure artifacts.
 *
 * Usage: node scripts/ci/sanitize-vrt-artifact.mjs <raw-dir> <out-dir>
 *
 * <raw-dir> must contain:
 *   - artifact.zip   opaque artifact downloaded by the preflight job
 *   - manifest.json  { source_run_id, pr_number, head_sha, artifact_sha256 }
 *
 * The script runs in a job with no secrets and contents:read only. It treats
 * the artifact as fully untrusted input and fails closed (non-zero exit) on
 * ANY validation failure:
 *   1. artifact.zip SHA-256 must match manifest.artifact_sha256.
 *   2. The ZIP central directory is parsed in pure Node (Buffer + zlib) and
 *      rejected before extraction on: absolute paths, ".." segments, symlink
 *      entries, entry count > 500, per-entry uncompressed size (> 10 MiB for
 *      .png, > 32 KiB for text), total uncompressed > 200 MiB, and per-entry
 *      compression ratio > 100 (zip bomb).
 *   3. Only Playwright output PNGs are extracted: paths under test-results/
 *      ending in -expected.png / -actual.png / -diff.png, plus any .png
 *      under tests/vrt/__screenshots__/. Everything else is ignored.
 *   4. Every selected PNG is re-encoded with sharp (metadata and ancillary
 *      chunks stripped), one file at a time, with hard caps on dimensions,
 *      pixel counts, and byte sizes.
 *   5. Output: flat sanitized PNGs, summary.txt, and manifest.json with the
 *      SHA-256 of every written file.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import sharp from "sharp";

const MAX_ZIP_BYTES = 100 * 1024 * 1024;
const MAX_ENTRIES = 500;
const MAX_PNG_ENTRY_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_ENTRY_BYTES = 32 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 100;
const MAX_SELECTED_PNGS = 12;
const MAX_OUTPUT_PNG_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_OUTPUT_PNG_BYTES = 60 * 1024 * 1024;
const MAX_PNG_WIDTH = 4096;
const MAX_PNG_HEIGHT = 20000;
const MAX_PIXELS_PER_IMAGE = 40_000_000;
const MAX_TOTAL_PIXELS = 200_000_000;
const MAX_SUMMARY_BYTES = 32 * 1024;

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;

const TEXT_ENTRY_RE = /\.(txt|log|json|md)$/i;
// Extracted PNG paths must stay within a conservative charset so the summary,
// the flat output names, and log lines cannot smuggle anything surprising.
const SAFE_CANDIDATE_PATH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const SAFE_BASENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.png$/;

// Deterministic kind order: expected < actual < diff.
const TEST_RESULT_KINDS = [
	["-expected.png", 0],
	["-actual.png", 1],
	["-diff.png", 2],
];

class SanitizeError extends Error {}

function fail(message) {
	throw new SanitizeError(message);
}

function crc32(buffer) {
	if (typeof zlib.crc32 !== "function") {
		fail("Node.js >= 22.12 with zlib.crc32 is required");
	}
	return zlib.crc32(buffer) >>> 0;
}

function sha256Hex(buffer) {
	return createHash("sha256").update(buffer).digest("hex");
}

function asDigitString(value, field) {
	let text;
	if (typeof value === "number") {
		if (!Number.isSafeInteger(value) || value < 0) {
			fail(`manifest.json: ${field} must be a non-negative integer`);
		}
		text = String(value);
	} else if (typeof value === "string") {
		text = value;
	} else {
		fail(`manifest.json: ${field} must be a string of decimal digits`);
	}
	if (!/^[0-9]{1,20}$/.test(text)) {
		fail(`manifest.json: ${field} must be a string of decimal digits`);
	}
	return text;
}

function asHexString(value, length, field) {
	if (typeof value !== "string") {
		fail(`manifest.json: ${field} must be a hex string`);
	}
	const text = value.toLowerCase();
	if (!new RegExp(`^[0-9a-f]{${length}}$`).test(text)) {
		fail(`manifest.json: ${field} must be ${length} hex characters`);
	}
	return text;
}

function readInputManifest(rawDir) {
	const manifestPath = path.join(rawDir, "manifest.json");
	let parsed;
	try {
		parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	} catch (error) {
		fail(`manifest.json: unreadable or invalid JSON (${error.message})`);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		fail("manifest.json: must be a JSON object");
	}
	return {
		sourceRunId: asDigitString(parsed.source_run_id, "source_run_id"),
		prNumber: asDigitString(parsed.pr_number, "pr_number"),
		headSha: asHexString(parsed.head_sha, 40, "head_sha"),
		artifactSha256: asHexString(parsed.artifact_sha256, 64, "artifact_sha256"),
	};
}

function readArtifactZip(rawDir, expectedSha256) {
	const zipPath = path.join(rawDir, "artifact.zip");
	let stats;
	try {
		stats = fs.lstatSync(zipPath);
	} catch {
		fail("artifact.zip: missing");
	}
	if (!stats.isFile()) {
		fail("artifact.zip: not a regular file");
	}
	if (stats.size === 0) {
		fail("artifact.zip: empty file");
	}
	if (stats.size > MAX_ZIP_BYTES) {
		fail(`artifact.zip: ${stats.size} bytes exceeds limit ${MAX_ZIP_BYTES}`);
	}
	const buffer = fs.readFileSync(zipPath);
	const actualSha256 = sha256Hex(buffer);
	if (actualSha256 !== expectedSha256) {
		fail(
			`artifact.zip: SHA-256 mismatch (manifest ${expectedSha256}, actual ${actualSha256})`,
		);
	}
	return buffer;
}

function validateEntryName(name, nameBuffer) {
	const label = JSON.stringify(name);
	if (nameBuffer.length === 0) {
		fail("zip: empty entry name");
	}
	if (!Buffer.from(name, "utf8").equals(nameBuffer) || name.includes("�")) {
		fail(`zip: entry name is not valid UTF-8 (${label})`);
	}
	for (const char of name) {
		const code = char.codePointAt(0);
		if (code < 0x20 || code === 0x7f) {
			fail(`zip: control character in entry name (${label})`);
		}
	}
	if (name.includes("\\")) {
		fail(`zip: backslash in entry name ${label}`);
	}
	if (name.startsWith("/")) {
		fail(`zip: absolute entry path ${label}`);
	}
	if (/^[A-Za-z]:/.test(name)) {
		fail(`zip: drive-letter entry path ${label}`);
	}
	const normalized = name.endsWith("/") ? name.slice(0, -1) : name;
	if (normalized.length === 0) {
		fail(`zip: unsafe entry path ${label}`);
	}
	for (const segment of normalized.split("/")) {
		if (segment === "" || segment === "." || segment === "..") {
			fail(`zip: unsafe path segment in ${label}`);
		}
	}
}

function enforceEntrySizeLimit(name, uncompressedSize) {
	const label = JSON.stringify(name);
	if (name.toLowerCase().endsWith(".png")) {
		if (uncompressedSize > MAX_PNG_ENTRY_BYTES) {
			fail(
				`zip: PNG entry ${label} is ${uncompressedSize} bytes (limit ${MAX_PNG_ENTRY_BYTES})`,
			);
		}
	} else if (TEXT_ENTRY_RE.test(name)) {
		if (uncompressedSize > MAX_TEXT_ENTRY_BYTES) {
			fail(
				`zip: text entry ${label} is ${uncompressedSize} bytes (limit ${MAX_TEXT_ENTRY_BYTES})`,
			);
		}
	}
}

function findEndOfCentralDirectory(buffer) {
	if (buffer.length < 22) {
		fail("zip: file too small to be a ZIP archive");
	}
	const lowest = Math.max(0, buffer.length - 22 - 0xffff);
	for (let pos = buffer.length - 22; pos >= lowest; pos--) {
		if (buffer.readUInt32LE(pos) !== EOCD_SIG) {
			continue;
		}
		const commentLength = buffer.readUInt16LE(pos + 20);
		if (pos + 22 + commentLength === buffer.length) {
			return pos;
		}
	}
	fail("zip: end of central directory record not found");
}

function parseCentralDirectory(buffer) {
	const eocdPos = findEndOfCentralDirectory(buffer);
	if (
		eocdPos >= 20 &&
		buffer.readUInt32LE(eocdPos - 20) === ZIP64_LOCATOR_SIG
	) {
		fail("zip: ZIP64 archives are not allowed");
	}
	const diskNumber = buffer.readUInt16LE(eocdPos + 4);
	const centralDirDisk = buffer.readUInt16LE(eocdPos + 6);
	const entriesOnDisk = buffer.readUInt16LE(eocdPos + 8);
	const totalEntries = buffer.readUInt16LE(eocdPos + 10);
	const centralDirSize = buffer.readUInt32LE(eocdPos + 12);
	const centralDirOffset = buffer.readUInt32LE(eocdPos + 16);
	if (
		diskNumber !== 0 ||
		centralDirDisk !== 0 ||
		entriesOnDisk !== totalEntries
	) {
		fail("zip: multi-disk archives are not allowed");
	}
	if (
		totalEntries === 0xffff ||
		centralDirSize === 0xffffffff ||
		centralDirOffset === 0xffffffff
	) {
		fail("zip: ZIP64 archives are not allowed");
	}
	if (totalEntries === 0) {
		fail("zip: archive has no entries");
	}
	if (totalEntries > MAX_ENTRIES) {
		fail(`zip: entry count ${totalEntries} exceeds limit ${MAX_ENTRIES}`);
	}
	if (centralDirOffset + centralDirSize > eocdPos) {
		fail("zip: central directory extends past its end record");
	}

	const entries = [];
	const seenNames = new Set();
	let totalUncompressed = 0;
	let pos = centralDirOffset;
	for (let i = 0; i < totalEntries; i++) {
		if (pos + 46 > eocdPos) {
			fail("zip: truncated central directory header");
		}
		if (buffer.readUInt32LE(pos) !== CEN_SIG) {
			fail("zip: bad central directory signature");
		}
		const flags = buffer.readUInt16LE(pos + 8);
		const method = buffer.readUInt16LE(pos + 10);
		const crc = buffer.readUInt32LE(pos + 16);
		const compressedSize = buffer.readUInt32LE(pos + 20);
		const uncompressedSize = buffer.readUInt32LE(pos + 24);
		const nameLength = buffer.readUInt16LE(pos + 28);
		const extraLength = buffer.readUInt16LE(pos + 30);
		const commentLength = buffer.readUInt16LE(pos + 32);
		const diskStart = buffer.readUInt16LE(pos + 34);
		const externalAttrs = buffer.readUInt32LE(pos + 38);
		const localHeaderOffset = buffer.readUInt32LE(pos + 42);
		const nameEnd = pos + 46 + nameLength;
		if (nameEnd + extraLength + commentLength > eocdPos) {
			fail("zip: truncated central directory entry");
		}
		const nameBuffer = buffer.subarray(pos + 46, nameEnd);
		const name = nameBuffer.toString("utf8");
		validateEntryName(name, nameBuffer);
		const label = JSON.stringify(name);
		if (seenNames.has(name)) {
			fail(`zip: duplicate entry name ${label}`);
		}
		seenNames.add(name);
		if ((flags & 0x0001) !== 0) {
			fail(`zip: encrypted entry ${label}`);
		}
		if (method !== 0 && method !== 8) {
			fail(`zip: unsupported compression method ${method} for ${label}`);
		}
		if (
			compressedSize === 0xffffffff ||
			uncompressedSize === 0xffffffff ||
			localHeaderOffset === 0xffffffff
		) {
			fail(`zip: ZIP64 entry values are not allowed (${label})`);
		}
		if (diskStart !== 0) {
			fail(`zip: multi-disk entry ${label}`);
		}
		const unixMode = externalAttrs >>> 16;
		if ((unixMode & 0xf000) === 0xa000) {
			fail(`zip: symlink entry ${label}`);
		}
		const isDirectory = name.endsWith("/");
		if (isDirectory && (compressedSize !== 0 || uncompressedSize !== 0)) {
			fail(`zip: directory entry with data ${label}`);
		}
		if (!isDirectory) {
			if (compressedSize === 0 && uncompressedSize !== 0) {
				fail(
					`zip: compression ratio of ${label} exceeds ${MAX_COMPRESSION_RATIO}`,
				);
			}
			if (
				compressedSize > 0 &&
				uncompressedSize / compressedSize > MAX_COMPRESSION_RATIO
			) {
				fail(
					`zip: compression ratio of ${label} exceeds ${MAX_COMPRESSION_RATIO}`,
				);
			}
			enforceEntrySizeLimit(name, uncompressedSize);
			totalUncompressed += uncompressedSize;
			if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
				fail(
					`zip: total uncompressed size exceeds ${MAX_TOTAL_UNCOMPRESSED_BYTES} bytes`,
				);
			}
		}
		entries.push({
			name,
			method,
			crc32: crc,
			compressedSize,
			uncompressedSize,
			localHeaderOffset,
			isDirectory,
		});
		pos = nameEnd + extraLength + commentLength;
	}
	if (pos !== centralDirOffset + centralDirSize) {
		fail("zip: central directory size mismatch");
	}
	return { entries, centralDirOffset };
}

function extractEntry(buffer, entry, centralDirOffset) {
	const label = JSON.stringify(entry.name);
	const localOffset = entry.localHeaderOffset;
	if (localOffset + 30 > buffer.length) {
		fail(`zip: local header of ${label} out of bounds`);
	}
	if (buffer.readUInt32LE(localOffset) !== LOC_SIG) {
		fail(`zip: bad local header signature for ${label}`);
	}
	const nameLength = buffer.readUInt16LE(localOffset + 26);
	const extraLength = buffer.readUInt16LE(localOffset + 28);
	const dataStart = localOffset + 30 + nameLength + extraLength;
	const dataEnd = dataStart + entry.compressedSize;
	if (dataEnd > centralDirOffset || dataEnd > buffer.length) {
		fail(`zip: data of ${label} out of bounds`);
	}
	const raw = buffer.subarray(dataStart, dataEnd);
	let data;
	if (entry.method === 0) {
		data = Buffer.from(raw);
	} else {
		try {
			data = zlib.inflateRawSync(raw, {
				maxOutputLength: Math.max(entry.uncompressedSize, 1),
			});
		} catch (error) {
			fail(`zip: failed to inflate ${label} (${error.message})`);
		}
	}
	if (data.length !== entry.uncompressedSize) {
		fail(`zip: uncompressed size mismatch for ${label}`);
	}
	if (crc32(data) !== entry.crc32 >>> 0) {
		fail(`zip: CRC-32 mismatch for ${label}`);
	}
	return data;
}

function classifyCandidate(name) {
	if (name.startsWith("test-results/")) {
		for (const [suffix, kindRank] of TEST_RESULT_KINDS) {
			if (name.endsWith(suffix)) {
				return { sortBase: name.slice(0, -suffix.length), kindRank };
			}
		}
		return null;
	}
	if (name.startsWith("tests/vrt/__screenshots__/") && name.endsWith(".png")) {
		return { sortBase: name.slice(0, -".png".length), kindRank: 0 };
	}
	return null;
}

// Playwright test-results directories are named <route>-<project>, so sorting
// on the path with the kind suffix stripped orders candidates by route name,
// then project, then kind (expected < actual < diff) deterministically.
function compareCandidates(a, b) {
	if (a.sortBase !== b.sortBase) {
		return a.sortBase < b.sortBase ? -1 : 1;
	}
	if (a.kindRank !== b.kindRank) {
		return a.kindRank - b.kindRank;
	}
	if (a.entry.name === b.entry.name) {
		return 0;
	}
	return a.entry.name < b.entry.name ? -1 : 1;
}

async function reencodePng(data, entryName) {
	const label = JSON.stringify(entryName);
	let metadata;
	try {
		metadata = await sharp(data, {
			limitInputPixels: MAX_PIXELS_PER_IMAGE,
		}).metadata();
	} catch (error) {
		fail(`png: ${label}: unreadable image (${error.message})`);
	}
	if (metadata.format !== "png") {
		fail(`png: ${label}: not a PNG (detected ${metadata.format ?? "unknown"})`);
	}
	const { width, height } = metadata;
	if (
		!Number.isInteger(width) ||
		!Number.isInteger(height) ||
		width <= 0 ||
		height <= 0
	) {
		fail(`png: ${label}: missing image dimensions`);
	}
	if (width > MAX_PNG_WIDTH) {
		fail(`png: ${label}: width ${width} exceeds limit ${MAX_PNG_WIDTH}`);
	}
	if (height > MAX_PNG_HEIGHT) {
		fail(`png: ${label}: height ${height} exceeds limit ${MAX_PNG_HEIGHT}`);
	}
	const pixels = width * height;
	if (pixels > MAX_PIXELS_PER_IMAGE) {
		fail(
			`png: ${label}: ${pixels} pixels exceeds limit ${MAX_PIXELS_PER_IMAGE}`,
		);
	}
	let output;
	try {
		// A fresh pipeline re-encodes the raster only: metadata and ancillary
		// chunks of the untrusted input are dropped by default.
		output = await sharp(data, { limitInputPixels: MAX_PIXELS_PER_IMAGE })
			.png()
			.toBuffer();
	} catch (error) {
		fail(`png: ${label}: re-encode failed (${error.message})`);
	}
	if (output.length > MAX_OUTPUT_PNG_BYTES) {
		fail(
			`png: ${label}: re-encoded size ${output.length} exceeds limit ${MAX_OUTPUT_PNG_BYTES}`,
		);
	}
	return { output, pixels };
}

function allocateOutputName(baseName, usedNames) {
	if (!usedNames.has(baseName)) {
		usedNames.add(baseName);
		return baseName;
	}
	const stem = baseName.slice(0, -".png".length);
	for (let i = 2; i <= MAX_SELECTED_PNGS + 1; i++) {
		const candidate = `${stem}-${i}.png`;
		if (!usedNames.has(candidate)) {
			usedNames.add(candidate);
			return candidate;
		}
	}
	fail(
		`could not allocate a unique output name for ${JSON.stringify(baseName)}`,
	);
}

function stripControlChars(text) {
	// Keep newline (0x0A) only; drop all other C0/C1 controls and DEL.
	return text.replace(
		// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control-char stripping
		/[ -	--]/g,
		"",
	);
}

function clampToBytes(text, maxBytes) {
	if (Buffer.byteLength(text, "utf8") <= maxBytes) {
		return text;
	}
	const marker = "\n[truncated]\n";
	const markerBytes = Buffer.byteLength(marker, "utf8");
	let out = "";
	for (const line of text.split("\n")) {
		const next = out === "" ? line : `${out}\n${line}`;
		if (Buffer.byteLength(next, "utf8") + markerBytes > maxBytes) {
			break;
		}
		out = next;
	}
	return `${out}${marker}`;
}

function buildSummary(input, candidates, selectedCount, excludedCount) {
	const failingDirs = new Set();
	for (const candidate of candidates) {
		const segments = candidate.entry.name.split("/");
		if (segments[0] === "test-results" && segments.length >= 3) {
			failingDirs.add(segments[1]);
		}
	}
	const lines = [
		"VRT failure artifact (sanitized)",
		`source_run_id: ${input.sourceRunId}`,
		`pr_number: ${input.prNumber}`,
		`head_sha: ${input.headSha}`,
		`selected_pngs: ${selectedCount}`,
		`excluded_pngs: ${excludedCount}`,
		"failing_test_dirs:",
	];
	const sortedDirs = [...failingDirs].sort();
	if (sortedDirs.length === 0) {
		lines.push("- (none under test-results/)");
	}
	for (const dir of sortedDirs) {
		lines.push(`- ${dir}`);
	}
	return clampToBytes(
		stripControlChars(`${lines.join("\n")}\n`),
		MAX_SUMMARY_BYTES,
	);
}

async function main() {
	const args = process.argv.slice(2);
	if (args.length !== 2) {
		fail(
			"usage: node scripts/ci/sanitize-vrt-artifact.mjs <raw-dir> <out-dir>",
		);
	}
	const rawDir = path.resolve(args[0]);
	const outDir = path.resolve(args[1]);
	let rawStats;
	try {
		rawStats = fs.statSync(rawDir);
	} catch {
		fail(`raw dir not found: ${rawDir}`);
	}
	if (!rawStats.isDirectory()) {
		fail(`raw dir is not a directory: ${rawDir}`);
	}
	if (fs.existsSync(outDir)) {
		if (!fs.statSync(outDir).isDirectory()) {
			fail(`out dir is not a directory: ${outDir}`);
		}
		if (fs.readdirSync(outDir).length > 0) {
			fail(`out dir is not empty: ${outDir}`);
		}
	}

	const input = readInputManifest(rawDir);
	const zip = readArtifactZip(rawDir, input.artifactSha256);
	const { entries, centralDirOffset } = parseCentralDirectory(zip);

	const candidates = [];
	for (const entry of entries) {
		if (entry.isDirectory) {
			continue;
		}
		const kind = classifyCandidate(entry.name);
		if (kind === null) {
			continue;
		}
		if (!SAFE_CANDIDATE_PATH_RE.test(entry.name)) {
			fail(`zip: unsafe characters in PNG path ${JSON.stringify(entry.name)}`);
		}
		if (entry.uncompressedSize === 0) {
			fail(`zip: empty PNG entry ${JSON.stringify(entry.name)}`);
		}
		candidates.push({ entry, ...kind });
	}
	if (candidates.length === 0) {
		fail("no VRT PNG candidates found in artifact");
	}
	candidates.sort(compareCandidates);
	const selected = candidates.slice(0, MAX_SELECTED_PNGS);
	const excludedCount = candidates.length - selected.length;

	const usedNames = new Set(["manifest.json", "summary.txt"]);
	const outputs = [];
	let totalOutputBytes = 0;
	let totalPixels = 0;
	for (const candidate of selected) {
		const baseName = candidate.entry.name.split("/").at(-1);
		if (!SAFE_BASENAME_RE.test(baseName)) {
			fail(`zip: unsafe PNG basename ${JSON.stringify(baseName)}`);
		}
		const data = extractEntry(zip, candidate.entry, centralDirOffset);
		const { output, pixels } = await reencodePng(data, candidate.entry.name);
		totalPixels += pixels;
		if (totalPixels > MAX_TOTAL_PIXELS) {
			fail(`png: total pixel count exceeds limit ${MAX_TOTAL_PIXELS}`);
		}
		totalOutputBytes += output.length;
		if (totalOutputBytes > MAX_TOTAL_OUTPUT_PNG_BYTES) {
			fail(
				`png: total output size exceeds limit ${MAX_TOTAL_OUTPUT_PNG_BYTES}`,
			);
		}
		outputs.push({
			name: allocateOutputName(baseName, usedNames),
			data: output,
		});
	}

	const summary = buildSummary(
		input,
		candidates,
		selected.length,
		excludedCount,
	);

	fs.mkdirSync(outDir, { recursive: true });
	const files = [];
	const writable = [
		...outputs,
		{ name: "summary.txt", data: Buffer.from(summary, "utf8") },
	];
	for (const file of writable) {
		fs.writeFileSync(path.join(outDir, file.name), file.data);
		files.push({
			name: file.name,
			sha256: sha256Hex(file.data),
			bytes: file.data.length,
		});
	}
	files.sort((a, b) => {
		if (a.name === b.name) {
			return 0;
		}
		return a.name < b.name ? -1 : 1;
	});
	const outputManifest = {
		source_run_id: input.sourceRunId,
		pr_number: input.prNumber,
		head_sha: input.headSha,
		files,
	};
	fs.writeFileSync(
		path.join(outDir, "manifest.json"),
		`${JSON.stringify(outputManifest, null, "\t")}\n`,
	);
	console.log(
		`sanitize-vrt-artifact: OK (${outputs.length} PNG file(s), ${excludedCount} excluded)`,
	);
}

main().catch((error) => {
	const message =
		error instanceof SanitizeError
			? error.message
			: (error.stack ?? String(error));
	console.error(`sanitize-vrt-artifact: FAIL: ${message}`);
	process.exit(1);
});
