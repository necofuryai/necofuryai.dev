/*
 * Icon data for the Svelte islands, resolved at build time.
 *
 * Given an icon name, @iconify/svelte fetches the icon's data from the Iconify
 * API in the visitor's browser after hydration. Given the data itself, it
 * renders the SVG straight away and sends no request. Navbar.astro resolves the
 * icons the islands use from the installed @iconify-json/* sets with
 * resolveIconData() and passes them to the islands as props, so the visitor's
 * browser never contacts the Iconify API and no icon set reaches the client
 * bundle.
 *
 * Kept free of imports so the unit tests can load it directly.
 */

// Iconify's defaults for the dimensions an icon set leaves out
const DEFAULT_DIMENSIONS = Object.freeze({
	left: 0,
	top: 0,
	width: 16,
	height: 16,
});

// Iconify would combine these across an alias chain; nothing here needs them,
// so an icon or alias that uses one stops the build instead of rendering wrong
const TRANSFORMATIONS = Object.freeze(["rotate", "hFlip", "vFlip"]);

const MAX_ALIAS_DEPTH = 8;

const own = (record, key) =>
	record && Object.hasOwn(record, key) ? record[key] : undefined;

/**
 * Returns the data of the icon `name` in an Iconify JSON icon set, following
 * aliases, with the set's default dimensions filled in. Throws for a name the
 * set does not contain, so a typo or an icon removed upstream fails the build.
 */
export function resolveIconData(set, name) {
	const label = `${set.prefix}:${name}`;
	const aliases = [];
	let current = name;
	while (own(set.icons, current) === undefined) {
		const alias = own(set.aliases, current);
		if (alias === undefined) {
			throw new Error(
				`Icon "${label}" is not in the installed @iconify-json/${set.prefix} set`,
			);
		}
		if (aliases.length === MAX_ALIAS_DEPTH) {
			throw new Error(
				`Icon "${label}" has an alias chain longer than ${MAX_ALIAS_DEPTH} steps`,
			);
		}
		aliases.push(alias);
		current = alias.parent;
	}

	const icon = set.icons[current];
	// The icon itself first, then each alias from the farthest to `name` itself,
	// so a nearer alias overrides what it inherits
	const layers = [icon, ...aliases.reverse()];
	for (const layer of layers) {
		for (const key of TRANSFORMATIONS) {
			if (layer[key] !== undefined) {
				throw new Error(
					`Icon "${label}" uses ${key}, which resolveIconData does not apply`,
				);
			}
		}
	}

	const data = { body: icon.body };
	for (const [key, fallback] of Object.entries(DEFAULT_DIMENSIONS)) {
		data[key] = set[key] ?? fallback;
		for (const layer of layers) {
			if (layer[key] !== undefined) data[key] = layer[key];
		}
	}
	return data;
}
