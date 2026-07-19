export type PlaylistArtwork = {
	urlTemplate: string;
	width: number;
	height: number;
	bgColor: string | null;
	textColors: string[];
};

export type PlaylistTrack = {
	id: string;
	title: string;
	artist: string;
	album: string | null;
	durationMs: number | null;
	url: string | null;
	previewUrl: string | null;
	artworkUrlTemplate: string | null;
};

export type PlaylistData = {
	placeholder: boolean;
	order: number;
	fetchedAt: string;
	id: string;
	storefront: string;
	name: string;
	curator: string | null;
	description: string | null;
	url: string;
	embedUrl: string;
	artwork: PlaylistArtwork | null;
	tracks: PlaylistTrack[];
};
