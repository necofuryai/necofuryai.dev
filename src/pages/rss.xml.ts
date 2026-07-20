import rss from "@astrojs/rss";
import { getSortedPosts } from "@utils/content-utils";
import { renderFeedContent } from "@utils/rss-content.mjs";
import { getPostUrlBySlug } from "@utils/url-utils";
import type { APIContext } from "astro";
import { siteConfig } from "@/config";

function stripInvalidXmlChars(str: string): string {
	return str.replace(
		// biome-ignore lint/suspicious/noControlCharactersInRegex: https://www.w3.org/TR/xml/#charsets
		/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\uFDD0-\uFDEF\uFFFE\uFFFF]/g,
		"",
	);
}

export async function GET(context: APIContext): Promise<Response> {
	const blog = await getSortedPosts();

	return rss({
		title: siteConfig.title,
		description: siteConfig.subtitle || "No description",
		site: context.site ?? "https://necofuryai.dev",
		items: blog.map((post) => {
			const content =
				typeof post.body === "string" ? post.body : String(post.body || "");
			const cleanedContent = stripInvalidXmlChars(content);
			return {
				title: post.data.title,
				pubDate: post.data.published,
				description: post.data.description || "",
				link: getPostUrlBySlug(post.id),
				content: renderFeedContent(cleanedContent, {
					promotion: post.data.promotion,
				}),
			};
		}),
		customData: `<language>${siteConfig.lang}</language>`,
	});
}
