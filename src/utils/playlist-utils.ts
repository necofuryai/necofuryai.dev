// Apple Music API の Artwork.url は "https://.../{w}x{h}bb.jpg" 形式のテンプレート。
// {f} プレースホルダーを含む形式 (serialized-server-data 由来) にも備えて両方を置換する。
export function artworkUrl(template: string, size: number): string {
	return template
		.replace("{w}", String(size))
		.replace("{h}", String(size))
		.replace("{f}", "webp");
}

export function formatDuration(durationMs: number | null): string {
	if (durationMs === null) {
		return "-:--";
	}
	const totalSeconds = Math.round(durationMs / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = String(totalSeconds % 60).padStart(2, "0");
	return `${minutes}:${seconds}`;
}
