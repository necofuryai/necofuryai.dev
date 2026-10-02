/**
 * @param width source width in px (positive integer)
 * @param height source height in px (positive integer)
 * @param boxHeightVh height of the full-width cover box in vh (positive; rounded to 0.01)
 */
export function coverImageSrcset(
	width: number,
	height: number,
	boxHeightVh: number,
): { widths: number[]; sizes: string };
