# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

necofuryai の技術ブログ (日本語)。[fuwari](https://github.com/saicaca/fuwari) テンプレート (commit `6d39b0d` 時点) をベースにした Astro 製静的サイト。Cloudflare Workers Static Assets で稼働中 (`wrangler.jsonc` の `custom_domain` で apex を配信)。

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
pnpm test:unit        # node --test (tests/unit/*.test.mjs)
pnpm test:ui          # Playwright UI スモークテスト (下記参照)
pnpm diff-skills      # .claude/skills/ にベンダリングした cloudflare/skills と上流の差分確認
```

- 全文検索 (Pagefind) はビルド成果物 (dist) からインデックスを生成するため、dev サーバーでは動作しない。検索の動作確認は `pnpm build && pnpm preview` で行う。
- PR 前に `pnpm check` と `pnpm build` が通ることを確認する (CONTRIBUTING.md の要件)。

## コミットメッセージと PR

IMPORTANT: コミットメッセージ (`git commit`) と PR タイトルは必ず英語で記述する (`<type>: <description>` 形式、type は feat/fix/refactor/docs/test/chore/perf/ci)。セッションの応答言語が日本語でも、この規則が常に優先される。PR 本文は日本語で書く。squash マージは PR タイトルをそのまま main のコミット subject に使うため、タイトルの言語がそのまま履歴の言語になる。

### UI スモークテスト

- テストは `tests/ui/pages.spec.ts`。CI では固定した desktop Chromium で実行する。
- ピクセル差分やコミット済みベースライン画像は使わない。全ルートの描画、テーマ切り替え、About の職務年表、Playlists の開閉・フォーカス復帰・iframe 不在、Swup 再訪後の操作を直接検証する。
- webServer が `pnpm preview` を起動するため、実行前に `pnpm build` が必要。
- 絞り込み: `pnpm test:ui --grep <パターン>` / `pnpm test:ui --project=desktop`
- レイアウトを変更した場合は、ローカルで desktop / mobile / dark の実表示を目視確認する。スクリーンショットの保存や CI の pixel diff は必須にしない。

## リリース前チェック

完了宣言・PR 作成の前に確認する (実行結果を証拠として示すこと):

1. `pnpm check`、`pnpm test:unit`、`pnpm build`、`pnpm test:ui` が通る (検索 (Pagefind) の動作確認は `pnpm build && pnpm preview` でのみ可能)
2. レイアウト変更時は desktop / mobile / dark を目視確認し、機能上重要な挙動は `tests/ui/` の semantic assertion に追加する
3. フィードに影響する変更時: ビルド後の `dist/rss.xml` が XML として妥当で、収益リンク開示が本文に存続していること
4. レイアウト・スクリプト変更時: GA4 ガード (`data-swup-ignore-script` + 手動 page_view 方式) が無傷で、追加した inline script が Swup の script 再実行に耐えること
5. 内部リンクは末尾スラッシュ付き、`draft: true` の記事は本番ビルドから除外されたまま

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

### アイコン

アイコンは 2 系統ある。`.astro` は `astro-icon` (ビルド時にローカルの `@iconify-json/*` から SVG を埋め込む。対象セットは `astro.config.mjs` の `icon({ include })` で指定)、Svelte 島は `@iconify/svelte` (実行時に `api.iconify.design` から取得するため第三者リクエストが発生する)。

どちらの系統も `iconify` / `iconify--*` クラスを出力しないため、`.iconify` を前提にした CSS やテストセレクタを書いてはならない。`@iconify/svelte` は v5 以降 `class` prop を渡すと自前のクラスを付与しなくなった (v4 は併記していた)。これは同世代の React / Vue 版と食い違う挙動で上流のバグと見られるが、当該クラスはパッケージ内で読み戻されない純粋な CSS フックのため機能上の影響はない。将来マージが復活してもクラスが増えるだけで無害。

### アクセス解析 (GA4)

- **出力条件** — 環境変数 `PUBLIC_GA_MEASUREMENT_ID` (測定 ID、`G-` 形式をビルド時に検証) が設定された本番ビルドでのみ `Layout.astro` が gtag スニペットを出力する (dev サーバーでは常に無効)。
- **計測は手動送信方式** — 初回ロードは `gtag("config")` の自動 page_view、Swup の SPA 遷移は `astro:page-load` イベントからの手動 page_view で page_title を正しく記録する。`astro:page-load` は swup の `page:view` から dispatch され、タイトル更新後に発火する (初回ロードでは発火しない)。
- **GA4 管理画面の設定とセット** — 拡張計測機能の「ブラウザの履歴イベントに基づくページの変更」を OFF にする運用が前提。ON に戻すと SPA 遷移が二重計測になる。
- **script 再実行からの除外** — `@swup/astro` の `reloadScripts` (デフォルト true) は遷移ごとにページ内の script を複製再実行するため、GA タグは `data-swup-ignore-script` 属性と再実行ガードで除外している。
- **`swup:enable` の正体** — swup コアが全フックを `swup:<フック名>` 形式の DOM CustomEvent としてブリッジするイベント。swup 初期化時 (load 後 idle、`window.swup` 代入後) に一度だけ発火する (イベント名が動的構築のため node_modules を文字列 grep しても見つからない)。一度きりのため遷移ごとの計測には使えず GA は `astro:page-load` を使うが、`Layout.astro` の Swup フック登録 (バナー高さ・TOC・PhotoSwipe 再生成) は `swup:enable` 依存で正常動作している (2026-07-19 Playwright 実測確認済み)。
- プライバシーポリシーは `/privacy/` (`src/content/spec/privacy.md` + `src/pages/privacy.astro`)。

### プレイリストページ (/playlists/)

Apple Music のプレイリストをビルド時データで静的表示するページ (`src/pages/playlists.astro` + `src/components/AppleMusicPlaylist.astro`)。
データは `src/data/playlists/*.json` にコミットされており、`pnpm fetch-playlists` (`scripts/fetch-playlists.mjs`) が公式 Apple Music API (`GET /v1/catalog/{storefront}/playlists/{id}`、developer token のみで認証、ユーザーサインイン不要) から再取得して上書きする。
実行には Apple Developer Program の資格情報 (環境変数 `APPLE_MUSIC_TEAM_ID` / `APPLE_MUSIC_KEY_ID` / `APPLE_MUSIC_PRIVATE_KEY`、`.env` 可) が必要で、developer token は実行のたびに ES256 で 1 時間分だけ署名生成する (長期トークンの保管・ローテーションはしない)。
取得はビルドの決定性を保つため `pnpm build` に組み込まず、手動または `.github/workflows/refresh-playlists.yml` (workflow_dispatch + 週次月曜。Replay が毎週日曜更新のため) で行う。
週次実行は `--weekly` フラグで Apple が実際に更新する 2 本 (Replay All Time + 現行年、`PLAYLISTS` 配列の `weekly: true` 印) のみ再取得し、fetchedAt 以外に変更がなければ書き込まない (= PR も作られない)。
全件再取得は workflow_dispatch の scope=all か手動 `pnpm fetch-playlists`。
年替わり時は `PLAYLISTS` 配列の入替とあわせて `weekly` 印を新しい現行年へ付け替える。
JSON の `placeholder: true` はプレースホルダーデータの印で、ページ上に注意書きが表示される。
トラック行のアートワークは 30 秒試聴ボタン (`data-am-preview-url`) で、共有 `<audio>` 1 本 (body 直下、`data-am-preview-ready` ガード) を全トラックで使い回し、Swup の `content:replace` イベントで再生を停止する (audio が差し替え対象外の body 直下で生き続けるため)。
データ更新 PR も通常の UI smoke を通す。トラック内容の変化に合わせた画像ファイルの更新は不要。
プレイリストの追加・並び替えはスクリプトの `PLAYLISTS` 配列で行い、ページは `src/data/playlists/*.json` を `order` 順に自動描画する。
表示構成は「Replay All Time + 現行年 + 直近 2 年」のローリングウィンドウ方針 (年替わり時は現行年を過去枠へ送り、最古の年を外す)。
方式選定の経緯と実装後の変更は `docs/apple-music-playlist-publishing-research.md` を参照。

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

`@swup/plugin@<4` / `minimatch@<10.2.2` / `brace-expansion@<5.0.8` の 3 つはバージョン固定ではなく、脆弱な brace-expansion の依存経路を断つためのセット。個別に消すとビルドが壊れる。

Dependabot PR の CI が全ジョブ `ERR_PNPM_BROKEN_LOCKFILE` (duplicated mapping key) で全滅した場合、原因は PR ではなく GitHub のテストマージ (古い main 基準の PR と main が同じ推移的依存を lockfile に追加し、テキストマージで重複キー化)。PR head の lockfile が健全なことを確認し (`git show origin/<branch>:pnpm-lock.yaml` で該当キーを grep)、人間名義で `@dependabot recreate` コメントを打つ。lockfile を手動修復して push しない (追加コミットを push すると以後その PR の自動 rebase が止まる)。bot 名義 (GITHUB_TOKEN) の `@dependabot` コマンドは拒否されるため自動化には使えない。
