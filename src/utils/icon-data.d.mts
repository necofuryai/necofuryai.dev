/** Dimensions and transformations an Iconify icon or alias may set */
interface IconProperties {
	left?: number;
	top?: number;
	width?: number;
	height?: number;
	rotate?: number;
	hFlip?: boolean;
	vFlip?: boolean;
}

/** The parts of an Iconify JSON icon set (@iconify-json/*) that resolveIconData reads */
export interface IconSet {
	prefix: string;
	icons: Record<string, IconProperties & { body: string }>;
	aliases?: Record<string, IconProperties & { parent: string }>;
	left?: number;
	top?: number;
	width?: number;
	height?: number;
}

/** Icon data that @iconify/svelte renders without contacting the Iconify API */
export interface ResolvedIconData {
	body: string;
	left: number;
	top: number;
	width: number;
	height: number;
}

/** Resolves the icon `name` in `set`, following aliases; throws for an unknown name */
export declare function resolveIconData(
	set: IconSet,
	name: string,
): ResolvedIconData;
