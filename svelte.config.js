import { vitePreprocess } from "@astrojs/svelte";

export default {
	preprocess: [vitePreprocess({ script: true })],
	// runes モードを自前のコンポーネントにだけ強制する。Svelte 5 は既定では
	// コンポーネント単位で rune を使っているかどうかを見てレガシーモードへ落ちるため、
	// rune を書いていないコンポーネントは暗黙に「トップレベルの let がリアクティブ」な
	// レガシー挙動のままになる。true に固定しておけば export let / $: / on:click といった
	// レガシー構文がコンパイルエラーになり、混在に気づかないまま戻ってしまうのを防げる。
	//
	// トップレベルの compilerOptions ではなく dynamicCompileOptions を使うのは、
	// 前者が node_modules 内の Svelte コンポーネントまで巻き込むため。依存パッケージが
	// どちらのモードで書かれているかはこちらが決める話ではなく (Svelte 5 がモード混在を
	// 許しているのはライブラリが独立して移行できるようにするため)、レガシー構文の依存を
	// 1 つ入れただけで node_modules を指すエラーでビルドが落ちる。
	// dynamicCompileOptions は dev / build 双方のコンパイル経路で適用されるので、
	// 自前コードへの強制力はトップレベル指定と変わらない。
	vitePlugin: {
		dynamicCompileOptions({ filename }) {
			if (filename.includes("node_modules")) return;
			return { runes: true };
		},
	},
};
