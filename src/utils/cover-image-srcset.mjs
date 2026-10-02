/*
 * srcset parameters for an image that fills a box spanning the full viewport
 * width and a fixed share of the viewport height with object-fit: cover (the
 * site banner).
 *
 * On landscape viewports the image is width-bound and renders 100vw wide. On
 * viewports narrower than the box height times the image's aspect ratio
 * (portrait phones and tablets) it is height-bound and renders wider than the
 * viewport, so a plain "100vw" would make the browser pick a candidate that is
 * too small. The switch is expressed as a media condition rather than
 * max(100vw, …vh) because Safari supports math functions in `sizes` only from
 * 26.4, and older versions fall back to 100vw.
 */

// Covers 1x laptops (1366) up to 4K at 150% or 1920px-wide 2x displays (3840).
// Phones need around 2600-2900 because they are height-bound. Astro drops the
// entries wider than the source and adds the source width in their place.
const COVER_IMAGE_WIDTHS = [1366, 1920, 2560, 2880, 3200, 3840];

function gcd(a, b) {
	return b === 0 ? a : gcd(b, a % b);
}

function assertPositiveInteger(name, value) {
	if (!Number.isInteger(value) || value <= 0) {
		throw new TypeError(`${name} must be a positive integer, got ${value}`);
	}
}

export function coverImageSrcset(width, height, boxHeightVh) {
	assertPositiveInteger("width", width);
	assertPositiveInteger("height", height);
	if (!Number.isFinite(boxHeightVh) || boxHeightVh <= 0) {
		throw new TypeError(
			`boxHeightVh must be a positive number, got ${boxHeightVh}`,
		);
	}

	// Work in hundredths of a vh so that fractional heights such as 37.5 stay
	// exact integers; finer fractions are rounded to 0.01vh.
	const boxHeightCentiVh = Math.round(boxHeightVh * 100);

	// The image becomes height-bound when the viewport aspect ratio (vw/vh)
	// drops below boxHeightVh * width / (100 * height).
	const numerator = boxHeightCentiVh * width;
	const denominator = 10000 * height;
	const divisor = gcd(numerator, denominator);
	const ratio = `${numerator / divisor}/${denominator / divisor}`;

	// The height-bound rendered width in hundredths of a vh, rounded up so the
	// browser never picks a candidate below it. Dividing the integers last keeps
	// exact results exact.
	const renderedVh = Math.ceil(numerator / height) / 100;

	return {
		widths: [...COVER_IMAGE_WIDTHS],
		sizes: `(min-aspect-ratio: ${ratio}) 100vw, ${renderedVh}vh`,
	};
}
