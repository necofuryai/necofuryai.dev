# necofuryai.dev

necofuryai の技術ブログです。日々の開発で得た知見、技術メモ、開発記録を書いています。

- サイト: https://necofuryai.dev/
- 記事の誤りのご指摘や修正提案は [Issues](https://github.com/necofuryai/necofuryai.dev/issues) / Pull Request で歓迎します

## 技術スタック

- [Astro](https://astro.build) — 静的サイトジェネレーター
- [Tailwind CSS](https://tailwindcss.com) — スタイリング
- [Svelte](https://svelte.dev) — インタラクティブコンポーネント
- [Pagefind](https://pagefind.app/) — 全文検索
- デプロイ先: Cloudflare Workers (Static Assets)

## 開発

Node.js >= 22.13.0 と [pnpm](https://pnpm.io) が必要です。

```sh
pnpm install          # 依存関係のインストール
pnpm dev              # 開発サーバー起動 (localhost:4321)
pnpm new-post <slug>  # 新しい記事の作成
pnpm build            # 本番ビルド (Pagefind インデックス生成込み)
pnpm preview          # ビルド結果のプレビュー
pnpm check            # astro check
pnpm type-check       # tsc --noEmit
pnpm lint             # Biome チェック (自動修正あり)
pnpm format           # Biome フォーマット
```

## アクセス解析

Google アナリティクス 4 (GA4) を使用しています。
ビルド時に環境変数 `PUBLIC_GA_MEASUREMENT_ID` (測定 ID) が設定されている場合のみ、本番ビルドにタグが出力されます。
未設定のビルドと開発サーバーでは計測は行われません。
収集する情報の詳細は[プライバシーポリシー](https://necofuryai.dev/privacy/)を参照してください。

## ライセンス

- コード: [MIT License](LICENSE)
- 記事コンテンツ: [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)

## Credits

Built on [fuwari](https://github.com/saicaca/fuwari) by [saicaca](https://github.com/saicaca) (MIT License), imported at commit `6d39b0d`.
