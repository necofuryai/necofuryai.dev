# necofuryai.dev

necofuryai の技術ブログです。日々の開発で得た知見、技術メモ、開発記録を書いています。

- サイト: https://necofuryai.dev/ (準備中)
- 記事の誤りのご指摘や修正提案は [Issues](https://github.com/necofuryai/necofuryai.dev/issues) / Pull Request で歓迎します

## 技術スタック

- [Astro](https://astro.build) — 静的サイトジェネレーター
- [Tailwind CSS](https://tailwindcss.com) — スタイリング
- [Svelte](https://svelte.dev) — インタラクティブコンポーネント
- [Pagefind](https://pagefind.app/) — 全文検索
- デプロイ先: Cloudflare Workers (Static Assets、予定)

## 開発

Node.js >= 20 と [pnpm](https://pnpm.io) が必要です。

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

## ライセンス

- コード: [MIT License](LICENSE)
- 記事コンテンツ: [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)

## Credits

Built on [fuwari](https://github.com/saicaca/fuwari) by [saicaca](https://github.com/saicaca) (MIT License), imported at commit `6d39b0d`.
