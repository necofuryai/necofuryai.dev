/**
 * Hostnames of promotion (referral/affiliate) link targets.
 * Shared by the rehype pipeline (astro.config.mjs) and the RSS feed so that
 * rel="sponsored" marking stays consistent across both renderers.
 * Add new hostnames here (e.g. Amazon) — lowercase, hostname only.
 */
export const SPONSORED_LINK_DOMAINS = ["app.usespeak.com"];
