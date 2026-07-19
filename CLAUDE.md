# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

necofuryai の技術ブログ (日本語)。[fuwari](https://github.com/saicaca/fuwari) テンプレート (commit `6d39b0d` 時点) をベースにした Astro 製静的サイト。デプロイ先は Cloudflare Workers Static Assets (予定)。

ライセンスは二重構成: コードは MIT、記事本文 (`src/content/` 以下) は CC BY-NC-SA 4.0。

## コマンド

pnpm 必須 (`scripts/check-package-manager.js` が preinstall で強制)。Node.js >= 22.12.0。

```sh
pnpm dev              # 開発サーバー (localhost:4321)
pnpm build            # astro build + Pagefind インデックス生成
pnpm preview          # dist のプレビュー
pnpm check            # astro check
pnpm type-check       # astro sync && tsc --noEmit
pnpm lint             # Biome check (自動修正込み、リポジトリ全体が対象)
pnpm format           # Biome format
pnpm new-post <slug>  # 記事の雛形作成 (src/content/posts/<slug>.md)
pnpm test:vrt         # Playwright 視覚回帰テスト (下記参照)
```

- 全文検索 (Pagefind) はビルド成果物 (dist) からインデックスを生成するため、dev サーバーでは動作しない。検索の動作確認は `pnpm build && pnpm preview` で行う。
- PR 前に `pnpm check` と `pnpm build` が通ることを確認する (CONTRIBUTING.md の要件)。

### VRT (視覚回帰テスト)

- テストは `tests/vrt/pages.spec.ts`。プロジェクトは desktop-light / mobile-width-light / desktop-dark の 3 種。
- スクリーンショット比較は CI でのみ実行される (`ignoreSnapshots: !process.env.CI`)。ローカル実行はページが描画エラーなく開けるかの確認のみ。
- ベースライン画像はローカルで更新しない。レンダリングが OS 依存のため、`.github/workflows/vrt-update-baselines.yml` (workflow_dispatch) が Playwright コンテナ内で候補を生成する。
- webServer が `pnpm preview` を起動するため、実行前に `pnpm build` が必要。
- 絞り込み: `pnpm test:vrt --grep <パターン>` / `pnpm test:vrt --project=desktop-light`

## アーキテクチャ

スタック: Astro 7 + Svelte 5 (インタラクティブ部分のみ島として使用) + Tailwind CSS 4 (`@tailwindcss/vite` 経由) + Stylus (一部スタイル) + Biome 2。

### Markdown パイプライン (astro.config.mjs)

Astro 7 のデフォルト (Rust 製プロセッサ) ではなく、`markdown.processor` に `unified()` ベースのパイプラインを明示指定している。`src/plugins/` の自作 remark/rehype プラグイン群 (admonition、GitHub カード、excerpt、reading time) が Rust プロセッサ非対応のため、この unified 指定を外してはならない。

- ディレクティブ記法 (`:::note`、`:::github{repo="..."}` 等) は remark-directive → `rehype-components` で `src/plugins/` のコンポーネントに変換される
- 数式は remark-math + rehype-katex、コードブロックは Expressive Code (カスタムプラグイン: 言語バッジ、コピーボタン)

### コンテンツ

- `src/content/posts/` — 記事。Zod スキーマは `src/content.config.ts`。frontmatter の `prevTitle` / `prevSlug` / `nextTitle` / `nextSlug` は内部用フィールドで、`src/utils/content-utils.ts` の getSortedPosts() がビルド時に注入する。手で書かない。
- `draft: true` の記事は本番ビルドでのみ除外され、dev では表示される (content-utils.ts の `import.meta.env.PROD` 分岐)。
- `src/content/spec/` — about ページ等の固定コンテンツ。
- `content.config.ts` の `collections` に型注釈を付けないこと。付けるとスキーマの型推論が消えて entry.data が unknown になる (ファイル内コメント参照)。

### サイト設定

`src/config.ts` に集約 (siteConfig / navBarConfig / profileConfig / licenseConfig / expressiveCodeConfig)。テーマ色は hue 値 (0–360) で管理され CSS 変数に展開される。UI 文言は `src/i18n/` (サイト言語は ja)。

### アクセス解析 (GA4)

環境変数 `PUBLIC_GA_MEASUREMENT_ID` (測定 ID、`G-` 形式をビルド時に検証) が設定された本番ビルドでのみ、`Layout.astro` が gtag スニペットを出力する (dev サーバーでは常に無効)。計測は手動送信方式: 初回ロードは `gtag("config")` の自動 page_view、Swup の SPA 遷移は `astro:page-load` イベント (swup の `page:view` から dispatch、タイトル更新後・初回ロードでは発火しない) からの手動 page_view で page_title を正しく記録する。`swup:enable` は swup コアが全フックを `swup:<フック名>` 形式の DOM CustomEvent としてブリッジするイベントで、swup 初期化時 (load 後 idle、`window.swup` 代入後) に一度だけ発火する (イベント名が動的構築のため node_modules を文字列 grep しても見つからない)。一度きりのイベントのため遷移ごとの計測には使えず GA は `astro:page-load` を使うが、`Layout.astro` の Swup フック登録 (バナー高さ・TOC・PhotoSwipe 再生成) は `swup:enable` 依存で正常動作している (2026-07-19 Playwright 実測確認済み)。この方式は GA4 管理画面で拡張計測機能の「ブラウザの履歴イベントに基づくページの変更」を OFF にする運用とセットであり、ON に戻すと SPA 遷移が二重計測になる。`@swup/astro` の `reloadScripts` (デフォルト true) は遷移ごとにページ内の script を複製再実行するため、GA タグは `data-swup-ignore-script` 属性と再実行ガードで除外している。プライバシーポリシーは `/privacy/` (`src/content/spec/privacy.md` + `src/pages/privacy.astro`)。

### プレイリストページ (/playlists/)

Apple Music のプレイリストをビルド時データで静的表示するページ (`src/pages/playlists.astro` + `src/components/AppleMusicPlaylist.astro`)。データは `src/data/playlists/*.json` にコミットされており、`pnpm fetch-playlists` (`scripts/fetch-playlists.mjs`) が公式 Apple Music API (`GET /v1/catalog/{storefront}/playlists/{id}`、developer token のみで認証、ユーザーサインイン不要) から再取得して上書きする。実行には Apple Developer Program の資格情報 (環境変数 `APPLE_MUSIC_TEAM_ID` / `APPLE_MUSIC_KEY_ID` / `APPLE_MUSIC_PRIVATE_KEY`、`.env` 可) が必要で、developer token は実行のたびに ES256 で 1 時間分だけ署名生成する (長期トークンの保管・ローテーションはしない)。取得はビルドの決定性を保つため `pnpm build` に組み込まず、手動または `.github/workflows/refresh-playlists.yml` (workflow_dispatch + 月次) で行う。JSON の `placeholder: true` はプレースホルダーデータの印で、ページ上に注意書きが表示される。埋め込みプレイヤーは click-to-load の facade (`is:inline` スクリプト、swup コンテナ内配置 + `data-am-facade-ready` ガード) で、初期ロードでは iframe を読み込まない。データ更新はページの描画内容を変えるため、更新 PR では `vrt-update-baselines.yml` による VRT ベースライン再生成が必要 (更新ワークフローが作る PR の本文にも記載)。方式選定の経緯は `docs/apple-music-playlist-publishing-research.md` を参照。

### ページ遷移 (Swup)

`@swup/astro` により `main` と `#toc` コンテナだけを差し替える SPA 的遷移を行う。ページ内スクリプトが「初回ロードで一度だけ実行される」前提は成り立たないため、クライアントサイドのスクリプトは Swup による再訪・差し替えを考慮すること。

`trailingSlash: "always"` 設定のため、内部リンクは必ず末尾スラッシュ付きで書く。

### Biome

- 対象はリポジトリ全体。タブインデント、ダブルクォート。
- `html.experimentalFullSupportEnabled: true` により .astro / .svelte も整形対象。
- `src/**/*.css` は Biome の対象外。Stylus (`.styl`) も対象外。
- CI (`.github/workflows/biome.yml`) でもチェックされる。

### 依存関係

`package.json` の `pnpm.overrides` は脆弱性対応のためのピン留め (Dependabot alerts 0 件を維持)。上流の推移的依存にパッチが行き渡るまで削除しない。
