import { visit } from "unist-util-visit";

/**
 * Adds rel="sponsored nofollow noopener" and target="_blank" to anchors
 * pointing at the given promotion domains, so that paid or referral links
 * are always marked per Google's outbound-link guidance.
 *
 * @param {{ domains?: string[] }} options
 * @returns {(tree: import("hast").Root) => void}
 */
export function rehypeSponsoredLinks(options = {}) {
	const domains = new Set((options.domains ?? []).map((d) => d.toLowerCase()));
	return (tree) => {
		visit(tree, "element", (node) => {
			if (node.tagName !== "a") return;
			const href = node.properties?.href;
			if (typeof href !== "string") return;
			let hostname;
			try {
				hostname = new URL(href).hostname;
			} catch {
				// Relative and invalid URLs cannot be external promotion links.
				return;
			}
			if (!domains.has(hostname)) return;
			node.properties.rel = ["sponsored", "nofollow", "noopener"];
			node.properties.target = "_blank";
		});
	};
}
