import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";

export function pathsEqual(path1: string, path2: string): boolean {
	const normalizedPath1 = path1.replace(/^\/|\/$/g, "").toLowerCase();
	const normalizedPath2 = path2.replace(/^\/|\/$/g, "").toLowerCase();
	return normalizedPath1 === normalizedPath2;
}

function joinUrl(...parts: string[]): string {
	const joined = parts.join("/");
	return joined.replace(/\/+/g, "/");
}

export function getPostUrlBySlug(slug: string): string {
	return url(`/posts/${slug}/`);
}

export function getTagUrl(tag: string): string {
	if (!tag) return url("/archive/");
	return url(`/archive/?tag=${encodeURIComponent(tag.trim())}`);
}

export function getCategoryUrl(category: string | null): string {
	if (
		!category ||
		category.trim() === "" ||
		category.trim().toLowerCase() === i18n(I18nKey.uncategorized).toLowerCase()
	)
		return url("/archive/?uncategorized=true");
	return url(`/archive/?category=${encodeURIComponent(category.trim())}`);
}

export function getDir(path: string): string {
	const lastSlashIndex = path.lastIndexOf("/");
	if (lastSlashIndex < 0) {
		return "/";
	}
	return path.substring(0, lastSlashIndex + 1);
}

export function url(path: string): string {
	return joinUrl("", import.meta.env.BASE_URL, path);
}

export const DEFAULT_OG_IMAGE = "/og-default.png";

// og:image / JSON-LD 用にカバー画像を絶対 URL へ解決する。
// 相対パスのカバー (astro:assets がビルド時に解決するもの) は head からは
// 参照できないため、デフォルト OG 画像にフォールバックする。
export function resolveOgImageUrl(
	image: string | undefined,
	site: URL | undefined,
): string | undefined {
	if (!site) return undefined;
	if (image && /^https?:\/\//.test(image)) return image;
	if (image?.startsWith("/")) return new URL(url(image), site).href;
	return new URL(url(DEFAULT_OG_IMAGE), site).href;
}
