import type { APIRoute } from "astro";

// Astro はビルド成果物 (CSS / JS / インポートされた画像) をすべて /_astro/ 配下に
// 出力する。Googlebot はページのレンダリングにこれらを取得するため、ここを
// Disallow するとスタイルもスクリプトも読み込まれないまま評価される。fuwari
// テンプレートの既定値には `Disallow: /_astro/` が入っていたが、Search Console の
// URL 検査で「20/23 件のリソースを読み込めませんでした (robots.txt によって
// ブロックされています)」と出ていたため 2026-08-08 に削除した。
//
// クロールを制限したいものが出てきても robots.txt には書かないこと。取得自体を
// 止めると meta robots / X-Robots-Tag の noindex が読まれず、URL だけがインデックス
// される。除外は 404.astro と同じくページ側の noindex で表明する。
const robotsTxt = `
User-agent: *
Allow: /

Sitemap: ${new URL("sitemap-index.xml", import.meta.env.SITE).href}
`.trim();

export const GET: APIRoute = () => {
	return new Response(robotsTxt, {
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
		},
	});
};
