import MarkdownIt from "markdown-it";
import container from "markdown-it-container";
import sanitizeHtml from "sanitize-html";
import { SPONSORED_LINK_DOMAINS } from "../constants/sponsored-domains.mjs";

/*
 * RSS renders post bodies with markdown-it instead of the site's unified
 * pipeline (per Astro's recommended feed setup), so the pieces that must not
 * be lost in feeds are reproduced here: the legal promotion notice, the
 * rel="sponsored" marking, and a plain-HTML fallback for admonitions.
 */

const ADMONITION_NAMES = ["note", "tip", "important", "warning", "caution"];

const PROMOTION_NOTICE_HTML =
	"<p>本記事はプロモーション (紹介リンク) を含みます</p>\n";

const parser = new MarkdownIt();
for (const name of ADMONITION_NAMES) {
	parser.use(container, name, {
		render(tokens, idx) {
			if (tokens[idx].nesting === 1) {
				// Feed readers strip classes, so use semantic markup only.
				return `<blockquote><p><strong>${name.toUpperCase()}</strong></p>\n`;
			}
			return "</blockquote>\n";
		},
	});
}

const sponsoredDomains = new Set(
	SPONSORED_LINK_DOMAINS.map((domain) => domain.toLowerCase()),
);

function markSponsoredLink(tagName, attribs) {
	const href = attribs.href;
	if (typeof href === "string") {
		let hostname;
		try {
			hostname = new URL(href).hostname;
		} catch {
			hostname = "";
		}
		if (sponsoredDomains.has(hostname)) {
			return {
				tagName,
				attribs: {
					...attribs,
					rel: "sponsored nofollow noopener",
					target: "_blank",
				},
			};
		}
	}
	return { tagName, attribs };
}

/**
 * Renders a post's markdown body to sanitized feed HTML.
 *
 * @param {string} markdown
 * @param {{ promotion?: boolean }} [options]
 * @returns {string}
 */
export function renderFeedContent(markdown, options = {}) {
	const html = sanitizeHtml(parser.render(markdown), {
		allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"]),
		allowedAttributes: {
			...sanitizeHtml.defaults.allowedAttributes,
			a: ["href", "name", "target", "rel"],
		},
		transformTags: { a: markSponsoredLink },
	});
	return options.promotion ? PROMOTION_NOTICE_HTML + html : html;
}
