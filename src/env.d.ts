// astro/client が宣言する ImportMetaEnv にマージされる (declaration merging)
interface ImportMetaEnv {
	// GA4 の測定 ID (G-XXXXXXXXXX)。未設定なら GA タグは出力されない。
	readonly PUBLIC_GA_MEASUREMENT_ID?: string;
}
